import type { ModuleEventArgs, RequestCharacterDetailsArgs } from '@/types/api-types'
import {
  getCharacterDetails,
  foundryRollCheck,
  foundryCharacterAction,
  foundryCastSpell,
  foundryConsumeItem,
  foundryGetStrikeDamage,
  foundrySendItemToChat,
  foundrySetWeaponLoaded,
  foundrySetWeaponDamageType,
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
import { TM } from '@/api/protocol'
import { stampTablemateChatOrigin } from './utils/foundry'

type GetEvent = { action: 'get' }

declare const game: GamePF2e
declare const Hooks: {
  on: (event: string, cb: (...args: unknown[]) => void) => number
  off: (event: string, id: number) => void
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
  [TM.SET_WEAPON_LOADED]: foundrySetWeaponLoaded,
  [TM.SET_WEAPON_DAMAGE_TYPE]: foundrySetWeaponDamageType,
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
const chatOriginStack: string[] = []
let recentChatOrigin: { userId: string; expiresAt: number } | undefined
let chatOriginStampingRegistered = false

function isCharacterRequest(args: ModuleEventArgs): args is RequestCharacterDetailsArgs {
  return args.action === TM.REQUEST_CHARACTER
}

function hasActorId(args: ModuleEventArgs): args is ModuleEventArgs & { actorId: string } {
  return 'actorId' in args && typeof args.actorId === 'string'
}

function userOwnsRequestedActor(args: RequestCharacterDetailsArgs): boolean {
  return game.actors.get(args.actorId)?.ownership[args.userId] === 3
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
        getCharacterDetails(a).then((result) => game.socket.emit(TM.CHANNEL, result))
      },
      2000,
      { leading: true, trailing: true }
    )
  }
  getChar[args.actorId](args)
}

function stampChatOrigin(message: unknown, data: unknown, originUserId: string) {
  const sourceUpdate = { flags: { tablemate: { originUserId } } }
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
    originUserId
  }
}

function currentChatOriginUserId(): string | undefined {
  const stacked = chatOriginStack[chatOriginStack.length - 1]
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
    if (originUserId) stampChatOrigin(message, data, originUserId)
  })
  Hooks.on('createChatMessage', (message) => {
    const originUserId = currentChatOriginUserId()
    if (originUserId) stampTablemateChatOrigin(message, originUserId)
  })
}

async function withChatOrigin<T>(originUserId: string, run: () => Promise<T>): Promise<T> {
  chatOriginStack.push(originUserId)
  try {
    return await run()
  } finally {
    const currentIndex = chatOriginStack.lastIndexOf(originUserId)
    if (currentIndex >= 0) chatOriginStack.splice(currentIndex, 1)
    retainRecentChatOrigin(originUserId)
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
      announceSelf()
      broadcastTargets()
      return
    }

    if (PASSIVE_ACTIONS.has(args.action)) return

    if (hasActorId(args)) {
      if (game.actors.get(args.actorId)?.ownership[args.userId] !== 3) {
        logger.warn('unowned character')
        return
      }
    }

    const handler = actionHandlers[args.action] as
      | ((a: ModuleEventArgs) => Promise<unknown>)
      | undefined
    if (handler) {
      withChatOrigin(args.userId, () => handler(args)).then((result) =>
        game.socket.emit(TM.CHANNEL, result)
      )
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
    userId: game.user._id
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
