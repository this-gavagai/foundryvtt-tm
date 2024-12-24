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
import type { Game, User, Hooks, GetEvent } from '@/types/foundry-types'

declare const game: Game
declare const Hooks: Hooks
const MODNAME = 'module.tablemate'

export function setupListener() {
  console.log('TABLEMATE: Setting up listener')
  if (!iAmObserverOrFallbackGM()) return
  announceSelf()

  game.socket.onAnyOutgoing((event: string, ...args: ModuleEventArgs[] | GetEvent[]) => {
    if (
      event === 'userActivity' ||
      event === 'template' ||
      event === 'manageFiles' ||
      args?.[0]?.action === 'get' ||
      (event.match('module.') && !event.match('module.tablemate'))
    )
      return
    console.log(`TM.SEND ${event}`, args)
  })

  game.socket.on(MODNAME, (args: ModuleEventArgs) => {
    console.log('TM.RECV (listener)', args)
    switch (args.action) {
      case 'anybodyHome':
        announceSelf()
        broadcastTargets()
        break
      case 'updateCharacterDetails':
        break
      case 'requestCharacterDetails':
        getCharacterDetails(args as RequestCharacterDetailsArgs).then((result) =>
          game.socket.emit(MODNAME, result)
        )
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
        console.log('event not caught', args.action, args)
    }
  })
  Hooks.on('targetToken', () => {
    broadcastTargets()
  })
}

// utility functions
function iAmFirstGM() {
  return (
    game.user.isGM &&
    !game.users
      .filter((user: User) => user.isGM && user.active)
      .some((other: User) => other._id < game.user._id)
  )
}
function iAmObserver() {
  return game.user.getFlag('tablemate', 'shared_display')
}
function observerIsOnline() {
  return (
    game.users.filter((user: User) => user.flags?.['tablemate']?.['shared_display'] && user.active)
      .length > 0
  )
}
function iAmObserverOrFallbackGM() {
  return iAmObserver() || (!observerIsOnline() && iAmFirstGM())
}
function announceSelf() {
  game.socket.emit(MODNAME, {
    action: 'listenerOnline',
    user: game.user._id
  })
}

function broadcastTargets() {
  game.socket.emit('module.tablemate', {
    action: 'shareTarget',
    userId: game.user._id,
    targets: game.user.targets.ids
  })
}
