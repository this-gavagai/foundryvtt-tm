import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { useThrottleFn } from '@vueuse/core'

import { merge } from 'lodash-es'
import { useServer } from '@/composables/server'

const { getSocket } = useServer()

const ackQueue: { [key: string]: Function } = {}
export function pushToAckQueue(uuid: string, callback: Function) {
  ackQueue[uuid] = callback
}

///////////////////////////////////////
// Setup Methods                     //
///////////////////////////////////////
export async function setupSocketListenersForActor(actorId: string, actor: Ref<Actor | undefined>) {
  const socket = await getSocket()
  socket.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'gmOnline':
        requestCharacterDetails(actorId)
        break
      case 'updateCharacterDetails':
        if (args.actorId === actorId) {
          actor.value = args.actor
          merge(actor.value!.system, args.system)
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
  socket.on('modifyDocument', (mods: any) => {
    switch (mods.request.type) {
      case 'Actor':
        mods.result.forEach((change: any) => {
          if (actor && change._id === actor.value?._id) {
            merge(actor.value, change)
          }
        })
        if (actor.value) requestCharacterDetails(actor.value!._id!)
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
async function sendCharacterRequest(actorId: string): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  const promise = new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'requestCharacterDetails',
      actorId: actorId,
      uuid
    })
    // ackQueue[uuid] = (args: any) => resolve(args)
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
  return promise
}
export const requestCharacterDetails = useThrottleFn(sendCharacterRequest, 3000, true, true)

///////////////////////////////////////
// Emit Methods                      //
///////////////////////////////////////
export async function updateActor(
  actor: Ref<Actor>,
  update: {},
  additionalOptions: null | { [key: string]: any } = null
): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve, reject) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Actor',
        options: { diff: true, render: true, ...additionalOptions },
        updates: [
          {
            _id: actor.value._id,
            ...update
          }
        ]
      },
      (r: any) => {
        r.result.forEach((change: any) => {
          merge(actor.value, change)
        })
        resolve(r)
      }
    )
  })
  return promise
}

export async function updateActorItem(
  actor: Ref<Actor>,
  itemId: string,
  update: {},
  additionalOptions: null | { [key: string]: any } = null
): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve, reject) => {
    socket.emit(
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
        resolve(r)
      }
    )
  })
  return promise
}

export async function deleteActorItem(actor: Ref<Actor>, itemId: string): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve, reject) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'delete',
        type: 'Item',
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value?._id
      },
      (r: any) => {
        _processDeletes(actor, r.result)
        resolve(r)
      }
    )
  })
  return promise
}

///////////////////////////////////////
// Action Request                    //
///////////////////////////////////////
export async function castSpell(
  actor: Ref<Actor>,
  spellId: string,
  castingLevel: number,
  castingSlot: number
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'castSpell',
      id: spellId,
      characterId: actor.value._id,
      rank: castingLevel,
      slotId: castingSlot,
      uuid: uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

export async function rollCheck(
  actor: Ref<Actor>,
  checkType: string,
  checkSubtype = '',
  modifiers = [],
  options = {}
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'rollCheck',
      characterId: actor.value._id,
      checkType,
      checkSubtype,
      modifiers,
      options,
      skipDialog: true,
      uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

export async function characterAction(
  actor: Ref<Actor>,
  characterAction: string,
  options = {}
): Promise<any> {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'characterAction',
      characterId: actor.value._id,
      characterAction,
      options,
      uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

export function _processDeletes(actor: Ref<Actor>, results: []) {
  results.forEach((d: string) => {
    const item = actor.value.items.find((i: any) => i._id === d)
    if (item) {
      const index = actor.value.items.indexOf(item)
      actor.value.items.splice(index, 1)
    }
  })
  requestCharacterDetails(actor.value._id)
}
export function _processUpdates(actor: Ref<Actor>, results: []) {
  results.forEach((change: any) => {
    let item = actor.value.items.find((a: any) => a._id == change._id)
    if (item) merge(item, change)
  })
  requestCharacterDetails(actor.value._id)
}
export function _processCreates(actor: Ref<Actor>, results: []) {
  results.forEach((c: any) => {
    actor.value.items.push(c)
  })
  requestCharacterDetails(actor.value._id)
}
