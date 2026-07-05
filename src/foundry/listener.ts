import type { ModuleEventArgs, RequestCharacterDetailsArgs } from '@/types/api-types'
import {
  getCharacterDetails,
  foundryRollCheck,
  foundryCharacterAction,
  foundryCastSpell,
  foundryConsumeItem,
  foundryGetStrikeDamage,
  foundrySendItemToChat,
  foundrySendCompendiumItemToChat,
  foundrySetWeaponLoaded,
  foundrySetWeaponDamageType,
  foundryAttachItem,
  foundryDetachItem,
  foundryToggleKineticAura,
  foundryCastStaffSpell,
  foundryFreeRoll,
  foundryRollDamage,
  foundryRollInlineCheck,
  foundryRunMacro,
  foundryRunActionable,
  foundryGetSpellDamage,
  foundryUpdateActor,
  foundryGetCompendiumItem,
  foundryAddCompendiumItem,
  foundryListCompendia,
  foundryGetCompendiumIndex,
  foundrySendChatMessage,
  foundryApplyDamage,
  foundryRerollChatRoll
} from './handlers'
import type { GamePF2e, UserPF2e } from '@7h3laughingman/pf2e-types'
import { debounce } from 'lodash-es'
import { logger } from '@/utils/utilities'
import { TM, PROTOCOL_VERSION, MODULE_ID } from '@/api/protocol'
import { stampTablemateChatOrigin, tablemateChatOriginUuid } from './utils/foundry'
import { resolveCapture, type CapturedMessage } from './chatCapture'

type GetEvent = { action: 'get' }

declare const game: GamePF2e
declare const Hooks: {
  on: (event: string, cb: (...args: unknown[]) => void) => number
  off: (event: string, id: number) => void
}
declare const ui: {
  notifications?: { error: (message: string, options?: object) => void }
}

// Running module release, read from the manifest Foundry parsed at load.
function moduleVersion(): string | undefined {
  return game.modules?.get?.(MODULE_ID)?.version ?? undefined
}

// Warn the GM at most once per incompatible client per window, so the 30s
// presence heartbeat doesn't spam a persistent error notification.
const VERSION_WARN_THROTTLE_MS = 10 * 60 * 1000
const versionWarnings = new Map<string, number>()

// Compare a connecting client's protocol version against ours. A mismatch
// (including a client too old to report one) means the wire protocol differs,
// so surface it to the GM with both human-readable versions for triage.
function checkClientVersion(args: ModuleEventArgs) {
  const protocol = 'protocol' in args ? args.protocol : undefined
  if (protocol === PROTOCOL_VERSION) return

  const userId = args.userId ?? 'unknown'
  const now = Date.now()
  const lastWarned = versionWarnings.get(userId)
  if (lastWarned && now - lastWarned < VERSION_WARN_THROTTLE_MS) return
  versionWarnings.set(userId, now)

  const appVersion = ('appVersion' in args && args.appVersion) || 'an older version'
  const message =
    `Tablemate version mismatch: a connected app (${appVersion}) is not compatible ` +
    `with this module (${moduleVersion() ?? 'unknown'}). Update both to the same ` +
    `release so they can talk to each other.`
  logger.warn('TABLEMATE: ' + message, {
    clientProtocol: protocol,
    moduleProtocol: PROTOCOL_VERSION
  })
  // Advisory only — a transient (non-permanent) notification so it warns the GM
  // without wedging an undismissable error on screen.
  ui.notifications?.error(message)
}

// Map of TM action → Foundry-side handler. Handler args are narrowed via
// Extract<ModuleEventArgs, { action: K }>, so each handler is type-checked
// against the matching args interface. Adding a new RPC is one entry here
// plus the handler definition itself.
type ActionHandlerMap = {
  [K in ModuleEventArgs['action']]?: (
    args: Extract<ModuleEventArgs, { action: K }>
  ) => Promise<unknown>
}

const actionHandlers: ActionHandlerMap = {
  [TM.ROLL_CHECK]: foundryRollCheck,
  [TM.CHARACTER_ACTION]: foundryCharacterAction,
  [TM.CAST_SPELL]: foundryCastSpell,
  [TM.CONSUME_ITEM]: foundryConsumeItem,
  [TM.GET_STRIKE_DAMAGE]: foundryGetStrikeDamage,
  [TM.SEND_CHAT_MESSAGE]: foundrySendChatMessage,
  [TM.SEND_ITEM_TO_CHAT]: foundrySendItemToChat,
  [TM.SEND_COMPENDIUM_ITEM_TO_CHAT]: foundrySendCompendiumItemToChat,
  [TM.SET_WEAPON_LOADED]: foundrySetWeaponLoaded,
  [TM.SET_WEAPON_DAMAGE_TYPE]: foundrySetWeaponDamageType,
  [TM.ATTACH_ITEM]: foundryAttachItem,
  [TM.DETACH_ITEM]: foundryDetachItem,
  [TM.TOGGLE_KINETIC_AURA]: foundryToggleKineticAura,
  [TM.CAST_STAFF_SPELL]: foundryCastStaffSpell,
  [TM.FREE_ROLL]: foundryFreeRoll,
  [TM.ROLL_DAMAGE]: foundryRollDamage,
  [TM.ROLL_INLINE_CHECK]: foundryRollInlineCheck,
  [TM.RUN_MACRO]: foundryRunMacro,
  [TM.RUN_ACTIONABLE]: foundryRunActionable,
  [TM.GET_SPELL_DAMAGE]: foundryGetSpellDamage,
  [TM.UPDATE_ACTOR]: foundryUpdateActor,
  [TM.GET_COMPENDIUM_ITEM]: foundryGetCompendiumItem,
  [TM.ADD_COMPENDIUM_ITEM]: foundryAddCompendiumItem,
  [TM.LIST_COMPENDIA]: foundryListCompendia,
  [TM.GET_COMPENDIUM_INDEX]: foundryGetCompendiumIndex,
  [TM.APPLY_DAMAGE]: foundryApplyDamage,
  [TM.REROLL_CHAT_ROLL]: foundryRerollChatRoll
}

// Actions that originate from this side (Foundry → browser) — the listener
// observes them on the wire but doesn't need to act on them.
const PASSIVE_ACTIONS = new Set<string>([
  TM.ACK,
  TM.LISTENER_ONLINE,
  TM.UPDATE_CHARACTER,
  TM.SHARE_TARGETS
])

const getChar: Record<string, (args: RequestCharacterDetailsArgs) => void> = {}
const CHAT_ORIGIN_GRACE_MS = 2000
// A request currently executing: userId drives chat attribution, uuid lets the
// createChatMessage hook resolve the matching capture (see chatCapture.ts).
type ChatOrigin = { userId: string; uuid?: string }
const chatOriginStack: ChatOrigin[] = []
let recentChatOrigin: { userId: string; expiresAt: number } | undefined
let chatOriginStampingRegistered = false

function isCharacterRequest(args: ModuleEventArgs): args is RequestCharacterDetailsArgs {
  return args.action === TM.REQUEST_CHARACTER
}

// ── Authorization ──────────────────────────────────────────────────────────
// Every client-initiated action declares its authorization requirement here.
// The dispatch loop checks it once, before invoking the handler, so a handler
// never runs against an actor the requesting user doesn't own. A new RPC added
// without an entry is denied by default (fail-closed).
//
//   'owner'      requester must OWN the target actor (resolved from actorId or
//                characterId). Covers rolls, spellcasting, equipment, damage,
//                chat-as-actor, item mutation, etc.
//   'world-user' no target actor; the requester need only be a known user of
//                this world. Covers read-only compendium browsing.
//
// NOTE: args.userId is self-reported over Foundry's module channel and cannot
// be authenticated there, so this is best-effort within Foundry's trust model
// (anyone with world login is trusted for player-level actions). It closes the
// previous gap where only actorId-keyed actions were checked at all, leaving
// every characterId-keyed action (nearly all of them) ungated.
type AuthRequirement = 'owner' | 'world-user'

type ActorLike = {
  ownership?: Record<string, number>
  testUserPermission?: (user: unknown, level: string | number) => boolean
}

const AUTH_POLICY: Partial<Record<ModuleEventArgs['action'], AuthRequirement>> = {
  [TM.ROLL_CHECK]: 'owner',
  [TM.CHARACTER_ACTION]: 'owner',
  [TM.CAST_SPELL]: 'owner',
  [TM.CAST_STAFF_SPELL]: 'owner',
  [TM.CONSUME_ITEM]: 'owner',
  [TM.GET_STRIKE_DAMAGE]: 'owner',
  [TM.GET_SPELL_DAMAGE]: 'owner',
  [TM.SEND_CHAT_MESSAGE]: 'owner',
  [TM.SEND_ITEM_TO_CHAT]: 'owner',
  [TM.SEND_COMPENDIUM_ITEM_TO_CHAT]: 'owner',
  [TM.SET_WEAPON_LOADED]: 'owner',
  [TM.SET_WEAPON_DAMAGE_TYPE]: 'owner',
  [TM.ATTACH_ITEM]: 'owner',
  [TM.DETACH_ITEM]: 'owner',
  [TM.TOGGLE_KINETIC_AURA]: 'owner',
  [TM.FREE_ROLL]: 'owner',
  [TM.ROLL_DAMAGE]: 'owner',
  [TM.ROLL_INLINE_CHECK]: 'owner',
  [TM.RUN_MACRO]: 'owner',
  [TM.RUN_ACTIONABLE]: 'owner',
  [TM.UPDATE_ACTOR]: 'owner',
  [TM.ADD_COMPENDIUM_ITEM]: 'owner',
  [TM.APPLY_DAMAGE]: 'owner',
  [TM.REROLL_CHAT_ROLL]: 'owner',
  [TM.GET_COMPENDIUM_ITEM]: 'world-user',
  [TM.LIST_COMPENDIA]: 'world-user',
  [TM.GET_COMPENDIUM_INDEX]: 'world-user'
}

function userOwnsActor(actor: ActorLike | undefined, userId: string): boolean {
  if (!actor) return false
  const user = game.users.get(userId)
  if (!user) return false
  // Prefer Foundry's canonical permission test, which also honours default
  // ownership; fall back to reading the ownership map (explicit entry, else
  // default) so an actor shared via ownership.default is still recognized.
  if (typeof actor.testUserPermission === 'function') {
    return actor.testUserPermission(user, 'OWNER')
  }
  const ownership = actor.ownership ?? {}
  return (ownership[userId] ?? ownership.default ?? 0) >= 3
}

function getActor(id: string): ActorLike | undefined {
  return game.actors.get(id) as unknown as ActorLike | undefined
}

function targetActorId(args: ModuleEventArgs): string | undefined {
  if ('actorId' in args && typeof args.actorId === 'string') return args.actorId
  if ('characterId' in args && typeof args.characterId === 'string') return args.characterId
  return undefined
}

function authorizeAction(args: ModuleEventArgs): boolean {
  const requirement = AUTH_POLICY[args.action]
  if (!requirement) return false // fail-closed: no policy → deny
  if (requirement === 'world-user') return !!game.users.get(args.userId)
  const id = targetActorId(args)
  return !!id && userOwnsActor(getActor(id), args.userId)
}

function userOwnsRequestedActor(args: RequestCharacterDetailsArgs): boolean {
  return userOwnsActor(getActor(args.actorId), args.userId)
}

function requestUuid(args: ModuleEventArgs): string | undefined {
  return 'uuid' in args && typeof args.uuid === 'string' ? args.uuid : undefined
}

// Turn a thrown handler into an error ack so the waiting app rejects its pending
// request immediately, instead of hanging until the client-side timeout. With
// no uuid there's nothing to correlate, so we only log.
function emitHandlerError(args: ModuleEventArgs, error: unknown) {
  logger.error('TABLEMATE: handler failed', args.action, error)
  const uuid = requestUuid(args)
  if (!uuid) return
  game.socket.emit(TM.CHANNEL, {
    action: TM.ACK,
    uuid,
    userId: game.user._id,
    error: error instanceof Error ? error.message : String(error)
  })
}

function handleCharacterRequest(args: RequestCharacterDetailsArgs) {
  if (!iAmFirstGM()) {
    logger.debug('TM.SKIP requestCharacterDetails: first active GM handles actor refresh', args)
    return
  }
  if (!userOwnsRequestedActor(args)) {
    logger.warn('unowned character')
    return
  }

  logger.debug('TM-Requested')
  if (!getChar[args.actorId]) {
    getChar[args.actorId] = debounce(
      (a: RequestCharacterDetailsArgs) => {
        getCharacterDetails(a)
          .then((result) => game.socket.emit(TM.CHANNEL, result))
          .catch((error) => logger.error('TABLEMATE: character refresh failed', a.actorId, error))
      },
      2000,
      { leading: true, trailing: true }
    )
  }
  getChar[args.actorId](args)
}

function stampChatOrigin(message: unknown, data: unknown, origin: ChatOrigin) {
  const tablemate: Record<string, unknown> = { originUserId: origin.userId }
  if (origin.uuid) tablemate.originUuid = origin.uuid
  const sourceUpdate = { flags: { tablemate } }
  const document = message as { updateSource?: (changes: typeof sourceUpdate) => unknown }
  if (typeof document.updateSource === 'function') {
    document.updateSource(sourceUpdate)
    return
  }

  if (!data || typeof data !== 'object') return
  const source = data as {
    flags?: { tablemate?: Record<string, unknown>; [key: string]: unknown }
  }
  source.flags ??= {}
  source.flags.tablemate = {
    ...source.flags.tablemate,
    ...tablemate
  }
}

function currentChatOrigin(): ChatOrigin | undefined {
  return chatOriginStack[chatOriginStack.length - 1]
}

function currentChatOriginUserId(): string | undefined {
  const stacked = currentChatOrigin()?.userId
  if (stacked) return stacked

  if (!recentChatOrigin) return undefined
  if (recentChatOrigin.expiresAt > Date.now()) return recentChatOrigin.userId
  recentChatOrigin = undefined
  return undefined
}

function retainRecentChatOrigin(originUserId: string) {
  recentChatOrigin = {
    userId: originUserId,
    expiresAt: Date.now() + CHAT_ORIGIN_GRACE_MS
  }
  globalThis.setTimeout(() => {
    if (recentChatOrigin?.userId === originUserId && recentChatOrigin.expiresAt <= Date.now()) {
      recentChatOrigin = undefined
    }
  }, CHAT_ORIGIN_GRACE_MS)
}

function setupChatOriginStamping() {
  if (chatOriginStampingRegistered) return
  chatOriginStampingRegistered = true

  Hooks.on('preCreateChatMessage', (message, data) => {
    const originUserId = currentChatOriginUserId()
    if (!originUserId) return
    // userId honours the grace window (attribution); uuid comes only from a
    // live stack entry, so it correlates a capture to the request that is
    // actually producing the message right now.
    stampChatOrigin(message, data, { userId: originUserId, uuid: currentChatOrigin()?.uuid })
  })
  Hooks.on('createChatMessage', (message) => {
    const originUserId = currentChatOriginUserId()
    if (originUserId) stampTablemateChatOrigin(message, originUserId)
    const uuid = tablemateChatOriginUuid(message)
    if (uuid) resolveCapture(uuid, message as CapturedMessage)
  })
}

async function withChatOrigin<T>(origin: ChatOrigin, run: () => Promise<T>): Promise<T> {
  chatOriginStack.push(origin)
  try {
    return await run()
  } finally {
    const currentIndex = chatOriginStack.lastIndexOf(origin)
    if (currentIndex >= 0) chatOriginStack.splice(currentIndex, 1)
    retainRecentChatOrigin(origin.userId)
  }
}

export function setupListener() {
  logger.info('TABLEMATE: Setting up listener')
  setupChatOriginStamping()
  announceSelf()

  game.socket.onAnyOutgoing((event: string, ...args: ModuleEventArgs[] | GetEvent[]) => {
    if (
      event === 'userActivity' ||
      event === 'template' ||
      event === 'manageFiles' ||
      event === 'time' ||
      args?.[0]?.action === 'get' ||
      (event.match('module.') && !event.match(TM.CHANNEL))
    )
      return
    logger.info(`TM.SEND ${event}`, args?.[0]?.action, args)
  })

  game.socket.on(TM.CHANNEL, (args: ModuleEventArgs) => {
    if (!args.userId) logger.warn('TM-missing: no userid', args)

    // Character refresh is not target-sensitive. Let the first active GM answer
    // it before target-proxy routing, otherwise an active-but-unusable proxy can
    // prevent actor data from ever refreshing.
    if (isCharacterRequest(args)) {
      handleCharacterRequest(args)
      return
    }

    if (!iAmProxyOrFallbackGM(args.userId)) return
    logger.info('TM.RECV (listener)', args)

    if (args.action === TM.ANYBODY_HOME) {
      checkClientVersion(args)
      announceSelf()
      broadcastTargets()
      return
    }

    if (PASSIVE_ACTIONS.has(args.action)) return

    if (!authorizeAction(args)) {
      logger.warn('TABLEMATE: unauthorized request rejected', args.action, args.userId)
      return
    }

    const handler = actionHandlers[args.action] as
      | ((a: ModuleEventArgs) => Promise<unknown>)
      | undefined
    if (handler) {
      const origin: ChatOrigin = { userId: args.userId, uuid: requestUuid(args) }
      withChatOrigin(origin, () => handler(args))
        .then((result) => game.socket.emit(TM.CHANNEL, result))
        .catch((error) => emitHandlerError(args, error))
    } else {
      logger.warn('event not caught', args.action, args)
    }
  })
}

// utility functions
function iAmFirstGM() {
  return (
    game.user.isGM &&
    !game.users
      .filter((user: UserPF2e) => user.isGM && user.active)
      .some((other: UserPF2e) => other._id! < game.user._id!)
  )
}
function isTablemateRootUser(user: UserPF2e | undefined) {
  return user?.flags?.tablemate?.character_sheet === 'root'
}
function targetingProxyFor(userId: string) {
  const proxyId = game.users.get(userId)?.flags?.tablemate?.targeting_proxy
  const proxyUser = typeof proxyId === 'string' ? game.users.get(proxyId) : undefined
  return isTablemateRootUser(proxyUser) ? undefined : proxyId
}
function iAmProxy(userId: string) {
  return targetingProxyFor(userId) === game.user._id
}
function proxyIsOnline(userId: string) {
  const proxyId = targetingProxyFor(userId)
  return (
    game.users.filter(
      (user: UserPF2e) => proxyId === user._id && user.active && !isTablemateRootUser(user)
    ).length > 0
  )
}
function iAmProxyOrFallbackGM(userId: string) {
  return iAmProxy(userId) || (!proxyIsOnline(userId) && iAmFirstGM())
}
function announceSelf() {
  game.socket.emit(TM.CHANNEL, {
    action: TM.LISTENER_ONLINE,
    userId: game.user._id,
    // Let the app run the reciprocal version check on its side.
    protocol: PROTOCOL_VERSION,
    moduleVersion: moduleVersion()
  })
}

function broadcastTargets() {
  const targets = game.users.reduce((acc: Record<string, string[]>, user: UserPF2e) => {
    acc[user._id ?? 0] = Array.from(user.targets.map((t: { id: string }) => t.id))
    return acc
  }, {})
  game.socket.emit(TM.CHANNEL, {
    action: TM.SHARE_TARGETS,
    targets: targets,
    userId: game.user._id
  })
}
