// TODO: add option to send chat message on certain api events
import type { Ref } from 'vue'
import type { Actor, World } from '@/types/pf2e-types'
import { useThrottleFn } from '@vueuse/core'

import { merge } from 'lodash-es'
import { useServer } from '@/composables/server'

const { getSocket } = useServer()

const ackQueue: { [key: string]: Function } = {}
function pushToAckQueue(uuid: string, callback: Function) {
  ackQueue[uuid] = callback
}

///////////////////////////////////////
// Setup Methods                     //
///////////////////////////////////////
async function setupSocketListenersForWorld(world: Ref<World>) {
  const socket = await getSocket()
  socket.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'acknowledged':
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid](args)
          delete ackQueue[args.uuid]
        }
        break
    }
  })
  socket.on('modifyDocument', (args: any) => {
    switch (args.request.type) {
      case 'Combat':
        socket.emit('world', (r: any) => (world.value = r))
        switch (args.request.action) {
          case 'create':
            _processCreates2(world.value.combats, args.result)
            break
          case 'update':
            _processUpdates2(world.value.combats, args.result)
            break
          case 'delete':
            _processDeletes2(world.value.combats, args.result)
            break
        }
        socket.emit('world', (r: any) => (world.value = r))
        break
      case 'Combatant':
        const combatId = args.request.parentUuid.split('.')?.[1]
        const combat = world.value?.combats.find((c: any) => c._id === combatId)
        switch (args.request.action) {
          case 'create':
            _processCreates2(combat.combatants, args.result)
            break
          case 'update':
            _processUpdates2(combat.combatants, args.result)
            break
          case 'delete':
            _processDeletes2(combat.combatants, args.result)
            break
        }
        socket.emit('world', (r: any) => (world.value = r))
        break
      case 'ChatMessage':
        break
    }
  })
}

async function setupSocketListenersForActor(actorId: string, actor: Ref<Actor | undefined>) {
  const socket = await getSocket()
  socket.on('module.tablemate', (args: any) => {
    switch (args.action) {
      case 'gmOnline':
        requestCharacterDetails(actorId)
        break
      case 'updateCharacterDetails':
        // if (args.actorId === actorId) {
        //   actor.value = args.actor
        //   merge(actor.value!.system, args.system)
        //   actor.value!.feats = args.feats
        // }
        break
    }
  })
  socket.on('modifyDocument', (args: any) => {
    if (!actor.value) return
    switch (args.request.type) {
      case 'Actor':
        args.result.forEach((change: any) => {
          if (change._id === actor.value?._id) {
            merge(actor.value, change)
          }
        })
        requestCharacterDetails(actor.value._id)
        break
      case 'Item':
        if (args.request.parentUuid !== 'Actor.' + actorId) break
        switch (args.request.action) {
          case 'update':
            _processUpdates2(actor.value.items, args.result)
            break
          case 'create':
            _processCreates2(actor.value.items, args.result)
            break
          case 'delete':
            _processDeletes2(actor.value.items, args.result)
            break
        }
        requestCharacterDetails(actor.value._id)
        break
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
const requestCharacterDetails = useThrottleFn(sendCharacterRequest, 3000, true, true)

///////////////////////////////////////
// Emit Methods                      //
///////////////////////////////////////
async function updateActor(
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
          requestCharacterDetails(actor.value._id)
        })
        resolve(r)
      }
    )
  })
  return promise
}

async function updateActorItem(
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
        _processUpdates2(actor.value.items, r.result)
        requestCharacterDetails(actor.value._id)
        resolve(r)
      }
    )
  })
  return promise
}

async function deleteActorItem(actor: Ref<Actor>, itemId: string): Promise<any> {
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
        _processDeletes2(actor.value.items, r.result)
        requestCharacterDetails(actor.value._id)
        resolve(r)
      }
    )
  })
  return promise
}

///////////////////////////////////////
// Action Request                    //
///////////////////////////////////////
async function castSpell(
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

async function rollCheck(
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

async function characterAction(
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
async function consumeItem(actor: Ref<Actor>, consumableId: string, options = {}) {
  const socket = await getSocket()
  const uuid = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    socket.emit('module.tablemate', {
      action: 'consumeItem',
      characterId: actor.value._id,
      consumableId,
      options,
      uuid
    })
    pushToAckQueue(uuid, (args: any) => resolve(args))
  })
}

function _processCreates2(set: any[], results: []) {
  results.forEach((c: any) => {
    set.push(c)
  })
}
function _processUpdates2(set: any[], results: []) {
  results.forEach((change: any) => {
    let item = set.find((a: any) => a._id == change._id)
    if (item) merge(item, change)
  })
}
function _processDeletes2(set: any[], results: []) {
  results.forEach((d: string) => {
    const index = set.find((i: any) => i._id === d)
    if (index != -1) set.splice(index, 1)
  })
}

export function useApi() {
  return {
    setupSocketListenersForWorld,
    setupSocketListenersForActor,
    requestCharacterDetails,
    updateActor,
    updateActorItem,
    deleteActorItem,
    castSpell,
    rollCheck,
    consumeItem,
    characterAction
  }
}
