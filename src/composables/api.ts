// TODO: (feature+) add option to send chat message on certain api events

import type { Ref } from 'vue'
import type {
  Actor,
  World,
  Item,
  Combat,
  ResolutionArgs,
  EventArgs,
  EventRequest,
  EventResponse
} from '@/types/pf2e-types'
import type { CharacterRef } from '@/components/Character.vue'
import { useThrottleFn } from '@vueuse/core'
import { ref } from 'vue'

import {
  getCharacterDetails,
  foundryCastSpell,
  foundryRollCheck,
  foundryCharacterAction,
  foundryConsumeItem
} from '@/foundry/actions'

import { merge } from 'lodash-es'
import { useServer } from '@/composables/server'
import { useTargetHelper } from '@/composables/targetHelper'

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
  socket.on('module.tablemate', (args: EventArgs) => {
    switch (args.action) {
      case 'acknowledged':
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid](args)
          delete ackQueue[args.uuid]
        }
        break
    }
  })
  socket.on('modifyDocument', (args: EventArgs) => {
    switch (args.request.type) {
      case 'Combat':
        switch (args.request.action) {
          case 'create':
            _processCreates(world.value.combats, args.result as Item[])
            break
          case 'update':
            _processUpdates(world.value.combats, args.result as Item[])
            break
          case 'delete':
            _processDeletes(world.value.combats, args.result as string[])
            break
        }
        requestWorldDetails(world)
        break
      case 'Combatant':
        const combatId = args.request.parentUuid.split('.')?.[1]
        const combat = world.value?.combats.find((c: Combat) => c._id === combatId)
        switch (args.request.action) {
          case 'create':
            _processCreates(combat.combatants, args.result as Item[])
            break
          case 'update':
            _processUpdates(combat.combatants, args.result as Item[])
            break
          case 'delete':
            _processDeletes(combat.combatants, args.result as string[])
            break
        }
        requestWorldDetails(world)
        break
      case 'ChatMessage':
        switch (args.request.action) {
          case 'create':
            _processCreates(world.value.messages, args.result as Item[])
            break
          case 'update':
            _processUpdates(world.value.messages, args.result as Item[])
            break
          case 'delete':
            _processDeletes(world.value.messages, args.result as string[])
            break
        }
        requestWorldDetails(world)
        break
    }
  })
}

async function setupSocketListenersForActor(
  actorId: string,
  actor: CharacterRef<Actor | undefined>
) {
  const socket = await getSocket()
  socket.on('module.tablemate', (args: EventArgs) => {
    if (!actor.value) return
    switch (args.action) {
      case 'listenerOnline':
        if (!parent.game) actor.requestCharacterDetails!()
        break
      case 'updateCharacterDetails':
        parseActorData(actorId, actor, args)
        break
      // case 'shareTarget':
      //   // TODO: (feature) other use cases here: non-shared display, gm targeting, etc
      //   if (parent.game) {
      //     console.log(args.targets)
      //     parent.game.user.updateTokenTargets(args.targets)
      //   }
    }
  })
  socket.on('modifyDocument', (args: EventArgs) => {
    if (!actor.value) return
    switch (args.request.type) {
      case 'Actor':
        args.result.forEach((change: any) => {
          if (change._id === actor.value?._id) {
            merge(actor.value, change)
          }
        })
        actor.requestCharacterDetails!()
        break
      case 'Item':
        if (!actor.value) return
        if (args.request.parentUuid !== 'Actor.' + actorId) break
        switch (args.request.action) {
          case 'update':
            _processUpdates(actor.value.items, args.result as Item[])
            break
          case 'create':
            _processCreates(actor.value.items, args.result as Item[])
            break
          case 'delete':
            _processDeletes(actor.value.items, args.result as string[])
            break
        }
        actor.requestCharacterDetails!()
        break
    }
  })
}

///////////////////////////////////////
// Emit Methods                      //
///////////////////////////////////////
async function updateActor(
  actor: CharacterRef<Actor>,
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
            _id: actor.value!._id,
            ...update
          }
        ]
      },
      (r: EventResponse) => {
        r.result.forEach((change: EventRequest) => {
          merge(actor.value, change)
          actor.requestCharacterDetails!()
        })
        resolve(r)
      }
    )
  })
  return promise
}

async function updateActorItem(
  actor: CharacterRef<Actor>,
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
        _processUpdates(actor.value.items, r.result)
        actor.requestCharacterDetails!()
        resolve(r)
      }
    )
  })
  return promise
}

async function deleteActorItem(actor: CharacterRef<Actor>, itemId: string): Promise<any> {
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
        _processDeletes(actor.value.items, r.result)
        actor.requestCharacterDetails!()
        resolve(r)
      }
    )
  })
  return promise
}

/////////////////////////////////////////////////
// Character and World Build Methods           //
/////////////////////////////////////////////////
// TODO: (refactor?) review call/response structure. Right now, this method doesn't use the ackQueue but instead listens to a separate response
// not using ackQueue allows for updates pushed from server, but makes this method a bit weird (and needing a timeout to prevent race conditions)
// for the world calls, as well, we need to not send subsequent ones until current are resolved, but perhaps there's a cleaner way than throttling
async function sendCharacterRequest(actorId: string, actor: Ref<Actor | undefined> = ref()) {
  if (parent.game) {
    setTimeout(async () => {
      const details = await getCharacterDetails({ actorId: actorId })
      parseActorData(actorId, actor, details)
    }, 300)
  } else {
    const socket = await getSocket()
    socket.emit('module.tablemate', {
      action: 'requestCharacterDetails',
      actorId: actorId
    })
  }
}
function parseActorData(actorId: string, actor: Ref<Actor | undefined>, args: any) {
  if (args.actorId === actorId) {
    actor.value = JSON.parse(args.actor)
    merge(actor.value!.system, JSON.parse(args.system))
    actor.value!.feats = JSON.parse(args.feats)
  }
}

async function sendWorldRequest(world: Ref<World | undefined>) {
  const socket = await getSocket()
  socket.emit('world', (r: any) => (world.value = r))
}
const requestWorldDetails = useThrottleFn(sendWorldRequest, 8000, true, false)

///////////////////////////////////////
// Action Request                    //
///////////////////////////////////////
async function castSpell(
  actor: Ref<Actor>,
  spellId: string,
  castingLevel: number,
  castingSlot: number
): Promise<ResolutionArgs> {
  const uuid = crypto.randomUUID()
  const args = {
    action: 'castSpell',
    id: spellId,
    characterId: actor.value._id,
    rank: castingLevel,
    slotId: castingSlot,
    uuid
  }
  if (parent.game) {
    return foundryCastSpell(args)
  } else {
    const socket = await getSocket()
    return new Promise((resolve, reject) => {
      socket.emit('module.tablemate', args)
      pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
    })
  }
}

async function rollCheck(
  actor: Ref<Actor>,
  checkType: string,
  checkSubtype = '',
  modifiers = [],
  options = {}
): Promise<ResolutionArgs> {
  const { targets } = useTargetHelper()
  const uuid = crypto.randomUUID()
  const args = {
    action: 'rollCheck',
    characterId: actor.value._id,
    targets: targets.value,
    checkType,
    checkSubtype,
    modifiers,
    options,
    skipDialog: true,
    uuid
  }
  if (parent.game) {
    return foundryRollCheck(args)
  } else {
    const socket = await getSocket()
    return new Promise((resolve, reject) => {
      socket.emit('module.tablemate', args)
      pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
    })
  }
}

async function characterAction(
  actor: Ref<Actor>,
  characterAction: string,
  options = {}
): Promise<ResolutionArgs> {
  const uuid = crypto.randomUUID()
  const args = {
    action: 'characterAction',
    characterId: actor.value._id,
    characterAction,
    options,
    uuid
  }
  if (parent.game) {
    return foundryCharacterAction(args)
  } else {
    const socket = await getSocket()
    return new Promise((resolve, reject) => {
      socket.emit('module.tablemate', args)
      pushToAckQueue(uuid, (args: any) => resolve(args))
    })
  }
}

async function consumeItem(actor: Ref<Actor>, consumableId: string, options = {}) {
  const uuid = crypto.randomUUID()
  const args = {
    action: 'consumeItem',
    characterId: actor.value._id,
    consumableId,
    options,
    uuid
  }
  if (parent.game) {
    return foundryConsumeItem(args)
  } else {
    const socket = await getSocket()
    return new Promise((resolve, reject) => {
      socket.emit('module.tablemate', args)
      pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
    })
  }
}

///////////////////////////////////////
// Processing Methods                //
///////////////////////////////////////
function _processCreates<Type>(set: any[], results: Item[]) {
  results.forEach((c: Item) => {
    set.push(c)
  })
}
function _processUpdates<Type>(set: any[], results: Item[]) {
  results.forEach((change: Item) => {
    let item = set.find((a: any) => a._id == change._id)
    if (item) merge(item, change)
  })
}
function _processDeletes<Type>(set: any[], results: string[]) {
  results.forEach((d: string) => {
    const index = set.find((i: any) => i._id === d)
    if (index != -1) set.splice(index, 1)
  })
}

///////////////////////////////////////
// Export                            //
///////////////////////////////////////
export function useApi() {
  return {
    setupSocketListenersForWorld,
    setupSocketListenersForActor,
    sendCharacterRequest,
    updateActor,
    updateActorItem,
    deleteActorItem,
    castSpell,
    rollCheck,
    consumeItem,
    characterAction
  }
}
