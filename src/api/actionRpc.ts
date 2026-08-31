import type { TablemateActorRef } from '@/types/character-types'
import type {
  AcknowledgementArgs,
  ModuleEventArgs,
  RequestResolutionArgs,
  ResponseByAction,
  RpcAction,
  DiceResults,
  CheckModifier,
  CheckSubtypeByType,
  CheckType,
  BlastDamageQuery,
  ApplyDamageMode,
  ChatRollRerollMode
} from '@/types/api-types'
import { logger, uuidv4 } from '@/utils/utilities'
import { getAuthenticatedSocket } from './internal'
import { requireStoreBridge } from './storeBridge'
import { TM, TM_ERROR_TARGET_UNRESOLVED, REQUEST_ACK_TIMEOUT_MS } from './protocol'

// Pending ack queue: uuid → resolver. Populated when an action RPC is sent,
// drained either by resolveAck() when the server acknowledges or by the
// timeout below.
//
// A Map, not a plain object: the key is `args.uuid` off a shared socket channel,
// so a payload naming 'constructor' or 'toString' would find an inherited
// function on an object literal and call it as a resolver. Same hazard, and the
// same reason, as the hasOwnProperty guard in foundry/rpcTable.ts — a Map simply
// has no prototype chain to fall through to.
const ackQueue = new Map<string, (args: RequestResolutionArgs) => void>()

// How long a caller waits for its ack. Shared with the Foundry side (protocol.ts)
// because the module has to know it too: a request that sat in the dispatch queue
// longer than this has a requester that already gave up, and must not be executed.
const ACK_TIMEOUT_MS = REQUEST_ACK_TIMEOUT_MS

function pushToAckQueue(
  uuid: string,
  resolve: (args: RequestResolutionArgs) => void,
  reject: (err: Error) => void,
  timeoutMs = ACK_TIMEOUT_MS
) {
  const timer = setTimeout(() => {
    if (ackQueue.has(uuid)) {
      ackQueue.delete(uuid)
      const message = `TM-WARN: request ${uuid} timed out after ${timeoutMs}ms`
      logger.warn(message)
      reject(new Error(message))
    }
  }, timeoutMs)
  ackQueue.set(uuid, (args) => {
    clearTimeout(timer)
    // A handler that threw on the Foundry side answers with an ack carrying an
    // `error` string; reject so the caller sees the real failure instead of
    // waiting out the full timeout. Test for presence, not truthiness — an
    // error whose message stringifies to '' is still a failure, not a success.
    if (args.error !== undefined) {
      logger.warn(`TM-WARN: request ${uuid} failed: ${args.error}`)
      // The module refused because none of the targets we named exist on the
      // scene we named — our mirror of the proxy's targeting is stale. Drop it
      // and re-ask here, at the one boundary every targeted RPC passes through,
      // so damage previews recover as well as rolls. The request itself still
      // rejects: silently retrying untargeted would reinstate exactly the
      // wrong-result-that-looks-right this refusal exists to prevent.
      // Guarded: this runs inside resolveAck's callback, before it drains the
      // queue entry, so anything thrown here would leave the caller's promise
      // pending until the 30s timeout instead of rejecting now.
      if (args.error === TM_ERROR_TARGET_UNRESOLVED) {
        try {
          requireStoreBridge().resyncTargets()
        } catch (bridgeError) {
          logger.debug('TM: could not resync targets after refusal', bridgeError)
        }
      }
      reject(new Error(args.error))
      return
    }
    resolve(args)
  })
}

// Called by the socket listener when the server sends an 'acknowledged' event.
// Resolves the matching pending request, if any.
export function resolveAck(uuid: string, args: RequestResolutionArgs) {
  const settle = ackQueue.get(uuid)
  if (!settle) return
  settle(args)
  ackQueue.delete(uuid)
}

// Reject every in-flight RPC. Called when the active server changes or is
// cleared (stores/serverAddress) — no ack can ever arrive from a different
// world, so without this every pending caller waits out the full 30s
// timeout, which on a sheet reads as a frozen button. NOT called on
// same-server socket swaps: acks are uuid-keyed broadcasts that still arrive
// on the replacement socket, and rejecting them would fake a failure for a
// mutation that succeeded. Routed through the normal error-ack path so
// timers are cleared.
export function rejectAllPending(reason: string) {
  // Snapshot the keys first — resolveAck mutates ackQueue as it drains each
  // entry. Routed through resolveAck (not a manual drain) so any future
  // bookkeeping added to the single documented drain path applies here too.
  for (const uuid of [...ackQueue.keys()]) {
    resolveAck(uuid, { action: TM.ACK, uuid, userId: '', error: reason })
  }
}

// Strongly-typed action dispatcher. Given a TM action constant, infers the
// matching args interface from the ModuleEventArgs union via `Extract` (so
// the payload object is type-checked against the right shape without an
// explicit `<XArgs>` generic at the call site) and resolves with that
// action's response contract from ResponseByAction.
async function sendAction<K extends RpcAction>(
  action: K,
  payload: Omit<Extract<ModuleEventArgs, { action: K }>, 'action' | 'userId' | 'uuid'>,
  timeoutMs?: number
): Promise<AcknowledgementArgs & ResponseByAction[K]> {
  const uuid = uuidv4()
  const { socket, userId } = await getAuthenticatedSocket()
  const args = { ...payload, action, userId, uuid }
  return new Promise<AcknowledgementArgs & ResponseByAction[K]>((resolve, reject) => {
    // The queue stores resolvers for heterogeneous in-flight requests widened
    // to the any-response shape; the wire delivers what the (same-typed)
    // Foundry handler returned for this action, so narrowing is sound.
    pushToAckQueue(uuid, resolve as (args: RequestResolutionArgs) => void, reject, timeoutMs)
    socket.emit(TM.CHANNEL, args)
  })
}

// Ask the module (the GM's client) to mint a signed push-registration token for
// the current user and hand back the relay URL. Resolves only if a GM client has
// push configured; otherwise it rejects (error ack) or times out like any RPC.
export async function registerPush() {
  return sendAction(TM.REGISTER_PUSH, {})
}

// Ask the named proxy's client to report its current targeting. Fire-and-forget
// (no ack): the answer comes back as an unsolicited SHARE_TARGETS, the same
// message shape the proxy pushes when it re-targets, so there is one code path
// on the receiving side. Failure to emit is not worth surfacing — the proxy's
// next target change re-syncs us anyway.
export async function requestTargets(proxyId: string) {
  try {
    const { socket, userId } = await getAuthenticatedSocket()
    socket.emit(TM.CHANNEL, { action: TM.REQUEST_TARGETS, userId, proxyId })
  } catch (error) {
    logger.debug('TM: could not request proxy targets', error)
  }
}

// Common payload prefixes. Every action needs characterId; most "interactive"
// actions also need the current target set. Callers guarantee the actor is
// loaded (non-null assertions match the old Ref<CharacterPF2e> contract).
const fromActor = (a: TablemateActorRef) => ({ characterId: a.value!._id! })
// `targetScene` rides along with `targets` so the module resolves the ids
// against the scene they were actually picked on. Both come from one read of
// the mirrored state, so an id list can never be paired with a scene from a
// different update.
const fromActorTargeted = (a: TablemateActorRef) => {
  const { sceneId, tokenIds } = requireStoreBridge().getTargets()
  return {
    characterId: a.value!._id!,
    targets: tokenIds,
    ...(sceneId ? { targetScene: sceneId } : {})
  }
}

export const castSpell = (
  actor: TablemateActorRef,
  spellId: string,
  castingLevel: number,
  castingSlot: number,
  overlayIds?: string[]
) =>
  sendAction(TM.CAST_SPELL, {
    ...fromActorTargeted(actor),
    id: spellId,
    rank: castingLevel,
    slotId: castingSlot,
    ...(overlayIds?.length ? { overlayIds } : {})
  })

export const castStaffSpell = (
  actor: TablemateActorRef,
  staffId: string,
  spellId: string,
  rank: number,
  overlayIds?: string[]
) =>
  sendAction(TM.CAST_STAFF_SPELL, {
    ...fromActorTargeted(actor),
    staffId,
    spellId,
    rank,
    ...(overlayIds?.length ? { overlayIds } : {})
  })

// Generic over the check type so each call site's subtype payload is checked
// against its own shape in CheckSubtypeByType (a strike can't be sent with a
// spell-attack payload). Types without a payload (perception, initiative, …)
// take undefined.
export const rollCheck = <K extends CheckType>(
  actor: TablemateActorRef,
  checkType: K,
  checkSubtype: CheckSubtypeByType[K],
  diceResults: DiceResults = {},
  modifiers: CheckModifier[] = [],
  options = {},
  item = null
) =>
  sendAction(TM.ROLL_CHECK, {
    ...fromActorTargeted(actor),
    item,
    checkType,
    checkSubtype,
    modifiers,
    diceResults,
    options
  })

export const characterAction = (
  actor: TablemateActorRef,
  characterAction: string,
  options = {},
  diceResults: DiceResults = {},
  modifierOverrides?: Record<string, boolean>,
  statisticSlug?: string
) =>
  sendAction(TM.CHARACTER_ACTION, {
    ...fromActorTargeted(actor),
    characterAction,
    diceResults,
    options,
    modifierOverrides,
    statisticSlug
  })

export const consumeItem = (actor: TablemateActorRef, consumableId: string, options = {}) =>
  sendAction(TM.CONSUME_ITEM, {
    ...fromActor(actor),
    consumableId,
    options
  })

// Swap a posted spell card to one of its variants. Rewrites the existing
// message rather than posting a new one, so the app sees the change arrive as
// an ordinary chat update.
export const selectSpellVariant = (
  actor: TablemateActorRef,
  messageId: string,
  overlayIds: string[],
  // Omit to let the module read the rank off the card being rewritten.
  castRank?: number
) =>
  sendAction(TM.SELECT_SPELL_VARIANT, {
    ...fromActor(actor),
    messageId,
    overlayIds,
    ...(castRank !== undefined ? { castRank } : {})
  })

export const getStrikeDamage = (
  actor: TablemateActorRef,
  actionSlug: string,
  altUsage: number | undefined = undefined,
  modifierOverrides?: Record<string, boolean>,
  // Blast formula lookups pass the blast target here (actionSlug stays '').
  blast?: BlastDamageQuery,
  // Chat-card callers name the usage instead of an altUsages index — see the
  // `strike` check subtype.
  card?: { itemId?: string; usage?: 'melee' | 'ranged' }
) =>
  // Untargeted: a damage preview describes the weapon, not a victim. See
  // GetStrikeDamageArgs.
  sendAction(TM.GET_STRIKE_DAMAGE, {
    ...fromActor(actor),
    actionSlug,
    altUsage,
    modifierOverrides,
    blast,
    ...(card?.itemId ? { itemId: card.itemId } : {}),
    ...(card?.usage ? { usage: card.usage } : {})
  })

export const getSpellDamage = (
  actor: TablemateActorRef,
  spellId: string,
  castingRank: number | undefined = undefined,
  modifierOverrides?: Record<string, boolean>,
  // Only a chat card supplies these — the sheet always previews the base spell.
  overlayIds?: string[]
) =>
  // Untargeted, as with strike damage — see GetStrikeDamageArgs.
  sendAction(TM.GET_SPELL_DAMAGE, {
    ...fromActor(actor),
    spellId,
    castingRank,
    modifierOverrides,
    ...(overlayIds?.length ? { overlayIds } : {})
  })

// Unified entry point for any ad-hoc damage roll — both the side-menu
// formula builder and inline @Damage[...] clicks. When `itemId` is set the
// handler routes through PF2e's _onClickInlineRoll pipeline (item header,
// trait pills, item-context modifiers); without it, posts a bare DamageRoll.
export const rollDamage = (
  actor: TablemateActorRef,
  formula: string,
  opts: {
    secret?: boolean
    diceResults?: DiceResults
    itemId?: string
    damageInline?: Record<string, string | true>
  } = {}
) =>
  sendAction(TM.ROLL_DAMAGE, {
    ...fromActorTargeted(actor),
    formula,
    secret: opts.secret ?? false,
    diceResults: opts.diceResults ?? {},
    itemId: opts.itemId,
    damageInline: opts.damageInline
  })

// Inline @Check[slug|against:def|...] route. Builds a synthetic PF2e inline-
// check anchor server-side and dispatches a click so PF2e's own listener
// resolves the check exactly as it would for a native enriched anchor —
// statistic lookup, target DC from `against`, traits/options/role propagation,
// chat-card flavor block.
export const rollInlineCheck = (
  actor: TablemateActorRef,
  slug: string,
  opts: {
    against?: string
    itemId?: string
    inline?: Record<string, string | true>
    secret?: boolean
    diceResults?: DiceResults
  } = {}
) =>
  sendAction(TM.ROLL_INLINE_CHECK, {
    ...fromActorTargeted(actor),
    slug,
    against: opts.against,
    itemId: opts.itemId,
    inline: opts.inline,
    secret: opts.secret ?? false,
    diceResults: opts.diceResults ?? {}
  })

export const sendItemToChat = (characterId: string, itemId: string) =>
  sendAction(TM.SEND_ITEM_TO_CHAT, { characterId, itemId })

export const sendChatMessage = (characterId: string, content: string, outOfCharacter = false) =>
  sendAction(TM.SEND_CHAT_MESSAGE, { characterId, content, outOfCharacter })

// Send one chunk of a recorded voice memo. The caller slices the audio, shares
// a single `uploadId` across the chunks, and awaits each chunk's ack before
// sending the next (natural ordering + backpressure). Metadata rides on every
// chunk; the GM reassembles and, on the final chunk, uploads the file and posts
// the chat message. See SendVoiceMemoArgs and foundry/handlers/chat.ts.
export const sendVoiceMemo = (
  characterId: string,
  chunk: { uploadId: string; seq: number; total: number; chunkBase64: string },
  meta: {
    mimeType: string
    durationMs: number
    content?: string
    outOfCharacter?: boolean
    whisper?: string[]
    // Tells the module a transcript is coming for this memo, so its push
    // notifier holds the notification briefly (see api/transcription.ts).
    transcriptPending?: boolean
  }
) => sendAction(TM.SEND_VOICE_MEMO, { characterId, ...chunk, ...meta })

// Send one chunk of a picked image. Mirrors sendVoiceMemo exactly — the caller
// slices the prepared image bytes, shares one `uploadId` across the chunks, and
// awaits each chunk's ack before sending the next. The GM reassembles and, on
// the final chunk, uploads the file and posts the chat message. See
// SendImageArgs and foundry/handlers/chat.ts.
export const sendImage = (
  characterId: string,
  chunk: { uploadId: string; seq: number; total: number; chunkBase64: string },
  meta: {
    mimeType: string
    width?: number
    height?: number
    content?: string
    outOfCharacter?: boolean
    whisper?: string[]
  }
) => sendAction(TM.SEND_IMAGE, { characterId, ...chunk, ...meta })

export const setWeaponLoaded = (
  actor: TablemateActorRef,
  weaponId: string,
  loaded: boolean,
  ammoId: string | null = null
) =>
  sendAction(TM.SET_WEAPON_LOADED, {
    ...fromActor(actor),
    weaponId,
    loaded,
    ammoId
  })

export const setWeaponDamageType = (
  actor: TablemateActorRef,
  weaponId: string,
  trait: 'versatile' | 'modular',
  selected: string | null
) =>
  sendAction(TM.SET_WEAPON_DAMAGE_TYPE, {
    ...fromActor(actor),
    weaponId,
    trait,
    selected
  })

export const attachItem = (actor: TablemateActorRef, itemId: string, parentId: string) =>
  sendAction(TM.ATTACH_ITEM, {
    ...fromActor(actor),
    itemId,
    parentId
  })

export const detachItem = (actor: TablemateActorRef, parentId: string, subitemId: string) =>
  sendAction(TM.DETACH_ITEM, {
    ...fromActor(actor),
    parentId,
    subitemId
  })

export const toggleKineticAura = (actor: TablemateActorRef) =>
  sendAction(TM.TOGGLE_KINETIC_AURA, fromActor(actor))

// Raw 1d20 roll — the Check Roll modal's "Roll d20" fallback when no stat
// chit is selected. Damage formulas no longer flow through here; use
// rollDamage() instead.
export const freeRoll = (
  characterId: string,
  secret: boolean,
  face?: number,
  traits?: string[],
  modifier?: number
) =>
  sendAction(TM.FREE_ROLL, {
    characterId,
    secret,
    diceResults: { d20: [face ?? 0] },
    ...(traits && traits.length ? { traits } : {}),
    ...(modifier ? { modifier } : {})
  })

// Run an arbitrary macro by UUID against the app character + the proxy's
// current targets. The macro receives `actor`, `token` (first target), and
// `targets` (all targets, as Token objects) in its execution scope, and
// `game.user.targets` presents the same selection while it runs — so a macro
// written against the ambient set works unchanged instead of acting on the
// handling GM's own reticle.
export const runMacro = (actor: TablemateActorRef, macroUuid: string) =>
  sendAction(TM.RUN_MACRO, {
    ...fromActorTargeted(actor),
    macroUuid
  })

// Run the PF2e-toolbelt "actionable" macro attached to an action/feat. The
// server looks up the macro UUID from the item's toolbelt flag and runs it
// with the full toolbelt scope (actor, item, token, targets, use, cancel),
// matching toolbelt's own useAction() entry point. Use this for any item
// that exposes a non-empty `macroId` from characterActions.
export const runActionable = (actor: TablemateActorRef, itemId: string) =>
  sendAction(TM.RUN_ACTIONABLE, {
    ...fromActorTargeted(actor),
    itemId
  })

export const addCompendiumItem = (
  characterId: string,
  itemUuid: string,
  spellcastingEntryId?: string
) => sendAction(TM.ADD_COMPENDIUM_ITEM, { characterId, itemUuid, spellcastingEntryId })

export const sendCompendiumItemToChat = (characterId: string, itemUuid: string) =>
  sendAction(TM.SEND_COMPENDIUM_ITEM_TO_CHAT, { characterId, itemUuid })

export const applyDamage = (
  actor: TablemateActorRef,
  messageId: string,
  mode: ApplyDamageMode,
  rollIndex?: number
) =>
  sendAction(TM.APPLY_DAMAGE, {
    ...fromActor(actor),
    messageId,
    mode,
    rollIndex
  })

// Toggle this user's emoji reaction on a chat message. No actor: reactions are
// the player's, so the payload is just the message and the emoji — the GM side
// derives the reactor from the request's userId. Resolves with the reaction list
// as stored, so the caller can reconcile its optimistic write.
export const toggleReaction = (messageId: string, emoji: string) =>
  sendAction(TM.TOGGLE_REACTION, { messageId, emoji })

// Write, edit, or remove one comment on a chat message. No actor: a comment
// belongs to the player, like a reaction — the GM side stamps it with the
// request's userId. Resolves with the comment list as stored, so the caller can
// reconcile against what actually landed.
export const setComment = (messageId: string, text: string, commentId?: string) =>
  sendAction(TM.SET_COMMENT, { messageId, text, commentId })

export const rerollChatRoll = (
  actor: TablemateActorRef,
  messageId: string,
  mode: ChatRollRerollMode,
  rollIndex?: number,
  diceResults: DiceResults = {}
) =>
  sendAction(TM.REROLL_CHAT_ROLL, {
    ...fromActor(actor),
    messageId,
    mode,
    diceResults,
    rollIndex
  })
