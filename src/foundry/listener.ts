import {
  getCharacterDetails,
  foundryRollCheck,
  foundryCharacterAction,
  foundryCastSpell,
  foundryConsumeItem
} from './actions'
import { Socket } from 'socket.io-client'

interface Game {
  socket: Socket
  user: User
  users: User[]
}
interface User {
  _id: string
  getFlag: Function
  isGM: boolean
  active: boolean
  flags: { [key: string]: any }
}

declare const game: Game
const MODNAME = 'module.tablemate'

export function setupListener() {
  if (iAmObserverOrFallbackGM()) announceSelf()

  game.socket.onAnyOutgoing((event: any, ...args: any) => {
    if (
      event === 'userActivity' ||
      event === 'template' ||
      event === 'manageFiles' ||
      event?.[0]?.action === 'get' ||
      (event.match('module.') && !event.match('module.tablemate'))
    )
      return
    console.log(`TM.SEND ${event}`, args)
    console.log(event)
  })

  // game.socket.on('modifyDocument', (args) => console.log(args))
  game.socket.on(MODNAME, (args: any) => {
    console.log('TM.RECV', args)
    if (!iAmObserverOrFallbackGM()) return
    switch (args.action) {
      case 'anybodyHome':
        announceSelf()
        break
      case 'requestCharacterDetails':
        getCharacterDetails(args).then((result) => game.socket.emit(MODNAME, result))
        break
      case 'updateCharacterDetails':
        break
      case 'rollCheck':
        foundryRollCheck(args).then((result) => game.socket.emit(MODNAME, result))
        break
      case 'characterAction':
        foundryCharacterAction(args).then((result) => game.socket.emit(MODNAME, result))
        break
      case 'castSpell':
        foundryCastSpell(args).then((result) => game.socket.emit(MODNAME, result))
        break
      case 'consumeItem':
        foundryConsumeItem(args).then((result) => game.socket.emit(MODNAME, result))
        break
      default:
        console.log('event not caught', args.action, args)
    }
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
    action: 'gmOnline'
  })
}
