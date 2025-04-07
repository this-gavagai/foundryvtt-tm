// TODO: player is able to see actor details for non-owned actors. fix the guardrail on this.
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
import { debounce } from 'lodash-es'
// import './lodash.min.js'

declare const game: Game
declare const Hooks: Hooks
const MODNAME = 'module.tablemate'

const getChar: Record<string, (args: RequestCharacterDetailsArgs) => void> = {}

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
    console.log(`TM.SEND ${event}`, args?.[0]?.action, args)
  })

  game.socket.on(MODNAME, (args: ModuleEventArgs) => {
    console.log('TM.RECV (listener)', args)
    if (args.action === 'anybodyHome') {
      announceSelf()
      broadcastTargets()
      return
    }

    // TODO: Install guard rails on actions with unowned characters (return error to sheet, don't just console.log it)
    if (args.hasOwnProperty('userId') && args.hasOwnProperty('actorId')) {
      const actorArgs = args as RequestCharacterDetailsArgs
      if (game.actors.get(actorArgs.actorId).ownership[actorArgs.userId] !== 3) {
        console.log('unowned character')
        return
      }
    }

    switch (args.action) {
      case 'updateCharacterDetails':
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
        console.log('event not caught', args.action, args)
    }
  })
  // Hooks.on('targetToken', (user, token) => {
  //   console.log('wee!', a)
  //   broadcastTargets()
  // })
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
  const targets = game.users.reduce((acc: Record<string, string[]>, user: User) => {
    acc[user._id] = Array.from(user.targets.map((t: { id: string }) => t.id))
    return acc
  }, {})
  game.socket.emit('module.tablemate', {
    action: 'shareTargets',
    targets: targets
  })
}
