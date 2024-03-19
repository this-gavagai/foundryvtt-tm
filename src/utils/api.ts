// todo: is there any way to refactor setupSocketListernsForActor so both actorId and actor aren't needed? right now, need both because actor may be empty
// TODO: convert everything to a promises based architecture to better support UI
// TODO: figure out how to make typed optional parameters so I don't need so many blank params in the code
// TODO: create a custom call that requests owned characters, to replace dependency on 'world' function for this
import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'

import { mergeDeep } from '@/utils/utilities'
import { useServer } from '@/composables/server'
import { useThrottleFn } from '@vueuse/core'

interface AckQueue {
  [key: string]: Function
}
const ackQueue: AckQueue = {}

const { socket } = useServer()
function socketReady() {
  // resolve when socket is ready
  return new Promise(function (resolve: any) {
    ;(function waitForSocket() {
      if (socket.value) return resolve()
      console.log('waiting on socket...')
      setTimeout(waitForSocket, 100)
    })()
  })
}

export async function setupSocketListenersForActor(actorId: string, actor: Ref<Actor | undefined>) {
  await socketReady()
  socket.value.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'gmOnline':
        requestCharacterDetails(actorId)
        break
      case 'updateCharacterDetails':
        if (args.actorId === actorId) {
          actor.value = args.actor
          mergeDeep(actor.value!.system, args.system)
          actor.value!.feats = args.feats
        }
        break
      case 'acknowledged':
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid](args)
          delete ackQueue[args.uuid]
        }
        break
      default:
        console.log('action not managed locally: ', args.action)
    }
  })
  socket.value.on('modifyDocument', (mods: any) => {
    switch (mods.request.type) {
      case 'Actor':
        mods.result.forEach((change: any) => {
          if (actor && change._id === actor.value!._id) {
            mergeDeep(actor.value, change)
          }
        })
        if (actor) requestCharacterDetails(actor.value!._id!)
        break
      case 'Item':
        // handle item types
        if (mods.request.parentUuid !== 'Actor.' + actorId) break
        if (!actor.value) break
        switch (mods.request.action) {
          case 'update':
            _processUpdates(actor as Ref<Actor>, mods.result)
            break
          case 'create':
            _processCreates(actor as Ref<Actor>, mods.result)
            break
          case 'delete':
            _processDeletes(actor as Ref<Actor>, mods.result)
            break
          default:
            console.log('item action not handled', mods.request.action, mods)
        }
        break
      case 'Combat':
      case 'Combatant':
        console.log('combat input')
      case 'ChatMessage':
        break
      default:
        console.log('request type not handled', mods.request.action, mods)
    }
  })
}

function _processDeletes(actor: Ref<Actor>, results: []) {
  results.forEach((d: string) => {
    const item = actor.value.items.find((i: any) => i._id === d)
    if (item) {
      const index = actor.value.items.indexOf(item)
      actor.value.items.splice(index, 1)
    }
  })
  requestCharacterDetails(actor.value._id)
}
function _processUpdates(actor: Ref<Actor>, results: []) {
  results.forEach((change: any) => {
    let item = actor.value.items.find((a: any) => a._id == change._id)
    if (item) mergeDeep(item, change)
  })
  requestCharacterDetails(actor.value._id)
}
function _processCreates(actor: Ref<Actor>, results: []) {
  results.forEach((c: any) => {
    actor.value.items.push(c)
  })
  requestCharacterDetails(actor.value._id)
}

export function updateActor(actor: Ref<Actor>, update: {}, additionalOptions = null): Promise<any> {
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
  actor: Ref<Actor>,
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
        parentUuid: 'Actor.' + actor.value?._id,
        updates: [
          {
            _id: itemId,
            ...update
          }
        ]
      },
      (r: any) => {
        _processUpdates(actor, r.result)
        // requestCharacterDetails(actor.value._id)
        resolve(r)
      }
    )
  })
  return promise
}

export function deleteActorItem(actor: Ref<Actor>, itemId: string): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    socket.value.emit(
      'modifyDocument',
      {
        action: 'delete',
        type: 'Item',
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value?._id
      },
      (r: any) => {
        _processDeletes(actor, r.result)
        // requestCharacterDetails(actor.value._id)
        resolve(r)
      }
    )
  })
  return promise
}

export const requestCharacterDetails = useThrottleFn(
  async (actorId: string): Promise<any> => {
    await socketReady()
    const uuid = crypto.randomUUID()
    const promise = new Promise((resolve, reject) => {
      socket.value.emit('module.tablemate', {
        action: 'requestCharacterDetails',
        actorId: actorId,
        uuid
      })
      ackQueue[uuid] = (args: any) => resolve(args)
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
    ackQueue[uuid] = (args: any) => {
      resolve(args)
    }
  })
  return promise
}

// interface ModifierTemplate {
//   label: string
//   modifier: number
// }
export function rollCheck(
  actor: Actor,
  checkType: string,
  checkSubtype = '',
  modifiers = [],
  options = {}
): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    const uuid = crypto.randomUUID()
    socket.value.emit('module.tablemate', {
      action: 'rollCheck',
      characterId: actor._id,
      checkType,
      checkSubtype,
      modifiers,
      options,
      skipDialog: true,
      uuid
    })
    ackQueue[uuid] = (args: any) => {
      resolve(args)
    }
  })
  return promise
}

export function characterAction(actor: Actor, characterAction: string, options = {}): Promise<any> {
  const promise = new Promise((resolve, reject) => {
    const uuid = crypto.randomUUID()
    socket.value.emit('module.tablemate', {
      action: 'characterAction',
      characterId: actor._id,
      characterAction,
      options,
      uuid
    })
    ackQueue[uuid] = (args: any) => {
      resolve(args)
    }
  })
  return promise
}
