import type { Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type {
  ModuleEventArgs,
  RequestResolutionArgs,
  DiceResults,
  CheckModifier
} from '@/types/api-types'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { logger, uuidv4 } from '@/utils/utilities'
import { getSocket, getUserId } from './internal'
import { TM } from './protocol'

// Pending ack queue: uuid → resolver. Populated when an action RPC is sent,
// drained either by resolveAck() when the server acknowledges or by the
// timeout below.
const ackQueue: { [key: string]: (args: RequestResolutionArgs) => void } = {}
const ACK_TIMEOUT_MS = 30_000

function pushToAckQueue(
  uuid: string,
  resolve: (args: RequestResolutionArgs) => void,
  reject: (err: Error) => void,
  timeoutMs = ACK_TIMEOUT_MS
) {
  const timer = setTimeout(() => {
    if (ackQueue[uuid]) {
      delete ackQueue[uuid]
      const message = `TM-WARN: request ${uuid} timed out after ${timeoutMs}ms`
      logger.warn(message)
      reject(new Error(message))
    }
  }, timeoutMs)
  ackQueue[uuid] = (args) => {
    clearTimeout(timer)
    resolve(args)
  }
}

// Called by the socket listener when the server sends an 'acknowledged' event.
// Resolves the matching pending request, if any.
export function resolveAck(uuid: string, args: RequestResolutionArgs) {
  if (ackQueue[uuid]) {
    ackQueue[uuid](args)
    delete ackQueue[uuid]
  }
}

// Strongly-typed action dispatcher. Given a TM action constant, infers the
// matching args interface from the ModuleEventArgs union via `Extract`, so
// the payload object is type-checked against the right shape without an
// explicit `<XArgs>` generic at the call site.
async function sendAction<K extends ModuleEventArgs['action']>(
  action: K,
  payload: Omit<Extract<ModuleEventArgs, { action: K }>, 'action' | 'userId' | 'uuid'>,
  timeoutMs?: number
): Promise<RequestResolutionArgs> {
  const uuid = uuidv4()
  const args = { ...payload, action, userId: getUserId(), uuid }
  const socket = await getSocket()
  return new Promise<RequestResolutionArgs>((resolve, reject) => {
    pushToAckQueue(uuid, resolve, reject, timeoutMs)
    socket.emit(TM.CHANNEL, args)
  })
}

// Common payload prefixes. Every action needs characterId; most "interactive"
// actions also need the current target set.
const fromActor = (a: Ref<CharacterPF2e>) => ({ characterId: a.value._id! })
const fromActorTargeted = (a: Ref<CharacterPF2e>) => ({
  characterId: a.value._id!,
  targets: useTargetHelperStore().getTargets()
})

export const castSpell = (
  actor: Ref<CharacterPF2e>,
  spellId: string,
  castingLevel: number,
  castingSlot: number
) =>
  sendAction(TM.CAST_SPELL, {
    ...fromActorTargeted(actor),
    id: spellId,
    rank: castingLevel,
    slotId: castingSlot
  })

export const castStaffSpell = (
  actor: Ref<CharacterPF2e>,
  staffId: string,
  spellId: string,
  rank: number
) =>
  sendAction(TM.CAST_STAFF_SPELL, {
    ...fromActorTargeted(actor),
    staffId,
    spellId,
    rank
  })

export const rollCheck = (
  actor: Ref<CharacterPF2e>,
  checkType: string,
  checkSubtype = '',
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
  actor: Ref<CharacterPF2e>,
  characterAction: string,
  options = {},
  diceResults: DiceResults = {}
) =>
  sendAction(TM.CHARACTER_ACTION, {
    ...fromActorTargeted(actor),
    characterAction,
    diceResults,
    options
  })

export const consumeItem = (
  actor: Ref<CharacterPF2e>,
  consumableId: string,
  options = {}
) =>
  sendAction(TM.CONSUME_ITEM, {
    ...fromActor(actor),
    consumableId,
    options
  })

export const getStrikeDamage = (
  actor: Ref<CharacterPF2e>,
  actionSlug: string,
  altUsage: number | undefined = undefined
) =>
  sendAction(TM.GET_STRIKE_DAMAGE, {
    ...fromActorTargeted(actor),
    actionSlug,
    altUsage
  })

export const getSpellDamage = (
  actor: Ref<CharacterPF2e>,
  spellId: string,
  castingRank: number | undefined = undefined
) =>
  sendAction(TM.GET_SPELL_DAMAGE, {
    ...fromActorTargeted(actor),
    spellId,
    castingRank
  })

// Unified entry point for any ad-hoc damage roll — both the side-menu
// formula builder and inline @Damage[...] clicks. When `itemId` is set the
// handler routes through PF2e's _onClickInlineRoll pipeline (item header,
// trait pills, item-context modifiers); without it, posts a bare DamageRoll.
export const rollDamage = (
  actor: Ref<CharacterPF2e>,
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
  actor: Ref<CharacterPF2e>,
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

export const setWeaponLoaded = (
  actor: Ref<CharacterPF2e>,
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
  actor: Ref<CharacterPF2e>,
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

export const toggleKineticAura = (actor: Ref<CharacterPF2e>) =>
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
// `targets` (all targets, as Token objects) in its execution scope. Macros
// that reference game.user.targets won't see the tablet's targets — they
// need to read from the scope instead.
export const runMacro = (actor: Ref<CharacterPF2e>, macroUuid: string) =>
  sendAction(TM.RUN_MACRO, {
    ...fromActorTargeted(actor),
    macroUuid
  })

// Run the PF2e-toolbelt "actionable" macro attached to an action/feat. The
// server looks up the macro UUID from the item's toolbelt flag and runs it
// with the full toolbelt scope (actor, item, token, targets, use, cancel),
// matching toolbelt's own useAction() entry point. Use this for any item
// that exposes a non-empty `macroId` from characterActions.
export const runActionable = (actor: Ref<CharacterPF2e>, itemId: string) =>
  sendAction(TM.RUN_ACTIONABLE, {
    ...fromActorTargeted(actor),
    itemId
  })

export const updateActorRemote = (actorId: string, update: object) =>
  sendAction(TM.UPDATE_ACTOR, { actorId, update })

export const getCompendiumItem = (itemUuid: string) =>
  sendAction(TM.GET_COMPENDIUM_ITEM, { itemUuid })

export const addCompendiumItem = (characterId: string, itemUuid: string) =>
  sendAction(TM.ADD_COMPENDIUM_ITEM, { characterId, itemUuid })

