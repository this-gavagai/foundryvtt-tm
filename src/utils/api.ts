// todo: is there any way to refactor setupSocketListernsForActor so both actorId and actor aren't needed? right now, need both because actor may be empty
// TODO: convert everything to a promises based architecture to better support UI

import type { Actor } from './pf2e-types'

import { mergeDeep } from '@/utils/utilities'
import { useServer } from '@/utils/server'
import { useThrottleFn } from '@vueuse/core'

interface AckQueue {
  [key: string]: Function
}
const { socket } = useServer()
const ackQueue: AckQueue = {}

export function setupSocketListenersForActor(actorId: string, actor: Actor) {
  socket.value.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'gmOnline':
        requestCharacterDetails(actorId)
        break
      case 'updateCharacterDetails':
        // this is super inefficient; there must be a more efficient way
        if (args.actorId === actorId) {
          actor.value = args.actor
          mergeDeep(actor.value.system, args.system)
          actor.value.feats = args.feats
          // actor.value.items = args.items
          // actor.value.inventory = args.inventory
          if (!window.actor) window.actor = actor.value
        }
        break
      case 'acknowledged':
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid]()
          delete ackQueue[args.uuid]
        }
        break
      default:
        console.log('roll not managed locally: ', args.action)
    }
  })
  socket.value.on('modifyDocument', (mods: any) => {
    switch (mods.request.type) {
      case 'Actor':
        mods.result.forEach((change: any) => {
          if (change._id === actor.value._id) {
            mergeDeep(actor.value, change)
          }
        })
        break
      case 'Item':
        // handle item types
        if (mods.request.parentUuid !== 'Actor.' + actorId) break
        switch (mods.request.action) {
          case 'update':
            _processUpdates(actor, mods.result)
            break
          case 'create':
            _processCreates(actor, mods.result)
            break
          case 'delete':
            _processDeletes(actor, mods.result)
            break
          default:
            console.log('item action not handled', mods.request.action, mods)
        }
        break
      case 'ChatMessage':
        break
      default:
        console.log('request type not handled', mods.request.action, mods)
    }
  })
}

function _processDeletes(actor: any, results: []) {
  results.forEach((d: string) => {
    const item = actor.value.items.find((i: any) => i._id === d)
    if (item) {
      const index = actor.value.items.indexOf(item)
      actor.value.items.splice(index, 1)
    }
  })
}
function _processUpdates(actor: any, results: []) {
  results.forEach((change: any) => {
    let item = actor.value.items.find((a: any) => a._id == change._id)
    if (item) mergeDeep(item, change)
  })
}
function _processCreates(actor: any, results: []) {
  results.forEach((c: any) => {
    actor.value.items.push(c)
  })
}

export function updateActor(actor: any, update: {}, additionalOptions = null): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    socket.value.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Actor',
        options: { diff: true, render: true },
        updates: [
          {
            _id: actor.value._id,
            ...update
          }
        ]
      },
      (r: any) => {
        r.result.forEach((change: any) => {
          mergeDeep(actor.value, change)
        })
        resolve(r)
      }
    )
  })
  return promise
}

interface OptionsBlock {
  [key: string]: any
}
export function updateActorItem(
  actor: Actor,
  itemId: string,
  update: {},
  additionalOptions: OptionsBlock
): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    socket.value.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Item',
        options: { diff: true, render: true, ...additionalOptions },
        parentUuid: 'Actor.' + actor.value._id,
        updates: [
          {
            _id: itemId,
            ...update
          }
        ]
      },
      (r: any) => {
        _processUpdates(actor, r.result)
        requestCharacterDetails(actor.value._id)
        resolve(r)
      }
    )
  })
  return promise
}

export function deleteActorItem(actor: Actor, itemId: string): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    socket.value.emit(
      'modifyDocument',
      {
        action: 'delete',
        type: 'Item',
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value._id
      },
      (r: any) => {
        _processDeletes(actor, r.result)
        requestCharacterDetails(actor.value._id)
        resolve(r)
      }
    )
  })
  return promise
}

export const requestCharacterDetails = useThrottleFn(
  (actorId: string): Promise<any> => {
    const uuid = crypto.randomUUID()
    const promise = new Promise((resolve, reject) => {
      socket.value.emit('module.tablemate', {
        action: 'requestCharacterDetails',
        actorId: actorId,
        uuid
      })
      ackQueue[uuid] = () => resolve('spell cast')
    })
    return promise
  },
  3000,
  true,
  true
)

export function castSpell(
  actor: Actor,
  spellId: string,
  castingLevel: number,
  castingSlot: number
): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    const uuid = crypto.randomUUID()
    socket.value.emit('module.tablemate', {
      action: 'castSpell',
      id: spellId,
      characterId: actor._id,
      rank: castingLevel,
      slotId: castingSlot,
      uuid: uuid
    })
    ackQueue[uuid] = () => resolve('spell cast')
  })
  return promise
}

interface ModifierTemplate {
  label: string
  modifier: number
}

export function rollCheck(
  actor: Actor,
  checkType: string,
  checkSubtype: string,
  modifiers: ModifierTemplate[]
): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    const uuid = crypto.randomUUID()
    socket.value.emit('module.tablemate', {
      action: 'rollCheck',
      characterId: actor._id,
      checkType,
      checkSubtype,
      modifiers,
      skipDialog: true,
      uuid: uuid
    })
    ackQueue[uuid] = () => {
      resolve('check rolled')
    }
  })
  return promise
}
