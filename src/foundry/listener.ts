import type {
  ModuleEventArgs,
  CastSpellArgs,
  CharacterActionArgs,
  ConsumeItemArgs,
  RequestCharacterDetailsArgs,
  RollCheckArgs,
  GetStrikeDamageArgs,
  SendItemToChatArgs,
  CallMacroArgs
} from '@/types/api-types'
import {
  getCharacterDetails,
  foundryRollCheck,
  foundryCharacterAction,
  foundryCastSpell,
  foundryConsumeItem,
  foundryGetStrikeDamage,
  foundrySendItemToChat,
  foundryCallMacro
} from './actions'
import type { GamePF2e, UserPF2e } from '@7h3laughingman/pf2e-types'
import { debounce } from 'lodash-es'
import { logger } from '@/utils/utilities'

type GetEvent = { action: 'get' }

declare const game: GamePF2e
const MODNAME = 'module.tablemate'

const getChar: Record<string, (args: RequestCharacterDetailsArgs) => void> = {}

export function setupListener() {
  logger.info('TABLEMATE: Setting up listener')
  announceSelf()

  game.socket.onAnyOutgoing((event: string, ...args: ModuleEventArgs[] | GetEvent[]) => {
    if (
      event === 'userActivity' ||
      event === 'template' ||
      event === 'manageFiles' ||
      event === 'time' ||
      args?.[0]?.action === 'get' ||
      (event.match('module.') && !event.match('module.tablemate'))
    )
      return
    logger.info(`TM.SEND ${event}`, args?.[0]?.action, args)
  })

  game.socket.on(MODNAME, (args: ModuleEventArgs) => {
    if (!args.userId) logger.warn('missing!', args)
    if (!iAmProxyOrFallbackGM(args.userId)) return
    logger.info('TM.RECV (listener)', args)
    if (args.action === 'anybodyHome') {
      announceSelf()
      broadcastTargets()
      return
    }

    if (args.hasOwnProperty('userId') && args.hasOwnProperty('actorId')) {
      const actorArgs = args as RequestCharacterDetailsArgs
      if (game.actors.get(actorArgs.actorId)?.ownership[actorArgs.userId] !== 3) {
        logger.warn('unowned character')
        return
      }
    }

    switch (args.action) {
      case 'listenerOnline':
      case 'updateCharacterDetails':
      case 'shareTargets':
        break
      case 'requestCharacterDetails':
        if (!getChar[args.actorId]) {
          getChar[args.actorId] = debounce(
            (args) => {
              getCharacterDetails(args as RequestCharacterDetailsArgs).then((result) =>
                game.socket.emit(MODNAME, result)
              )
            },
            2000,
            {
              leading: true,
              trailing: true
            }
          )
        }
        getChar[args.actorId](args as RequestCharacterDetailsArgs)
        // getCharacterDetails(args as RequestCharacterDetailsArgs).then((result) =>
        //   game.socket.emit(MODNAME, result)
        // )
        break
      case 'rollCheck':
        foundryRollCheck(args as RollCheckArgs).then((result) => game.socket.emit(MODNAME, result))
        break
      case 'characterAction':
        foundryCharacterAction(args as CharacterActionArgs).then((result) =>
          game.socket.emit(MODNAME, result)
        )
        break
      case 'castSpell':
        foundryCastSpell(args as CastSpellArgs).then((result) => game.socket.emit(MODNAME, result))
        break
      case 'consumeItem':
        foundryConsumeItem(args as ConsumeItemArgs).then((result) =>
          game.socket.emit(MODNAME, result)
        )
        break
      case 'getStrikeDamage':
        foundryGetStrikeDamage(args as GetStrikeDamageArgs).then((result) =>
          game.socket.emit(MODNAME, result)
        )
        break
      case 'sendItemToChat':
        foundrySendItemToChat(args as SendItemToChatArgs).then((result) =>
          game.socket.emit(MODNAME, result)
        )
        break
      case 'callMacro':
        foundryCallMacro(args as CallMacroArgs).then((result) => game.socket.emit(MODNAME, result))
        break
      default:
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
function iAmProxy(userId: string) {
  return game.users.get(userId)?.flags?.tablemate?.targeting_proxy === game.user._id
}
function proxyIsOnline(userId: string) {
  return (
    game.users.filter(
      (user: UserPF2e) =>
        game.users.get(userId)?.flags?.tablemate?.targeting_proxy === user._id && user.active
    ).length > 0
  )
}
function iAmProxyOrFallbackGM(userId: string) {
  return iAmProxy(userId) || (!proxyIsOnline(userId) && iAmFirstGM())
}
function announceSelf() {
  game.socket.emit(MODNAME, {
    action: 'listenerOnline',
    userId: game.user._id
  })
}

function broadcastTargets() {
  const targets = game.users.reduce((acc: Record<string, string[]>, user: UserPF2e) => {
    acc[user._id ?? 0] = Array.from(user.targets.map((t: { id: string }) => t.id))
    return acc
  }, {})
  game.socket.emit('module.tablemate', {
    action: 'shareTargets',
    targets: targets,
    userId: game.user._id
  })
}
