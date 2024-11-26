// TODO: (feature+) add option to send chat message on certain api events
// TODO: (known issue) this thing isn't triggering preUpdateActor hooks, as those are conventionally called only on the actor in question. May be a problem.
// TODO: currently setting actor.value on each refresh. This triggers tons of recalculations. Any way to merge reliably?
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
import { ref } from 'vue'

// TODO: these are being imported for the old local modality; not needed anymore?
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
// import { useWorld } from '@/composables/world'

const { getSocket } = useServer()
const ackQueue: { [key: string]: Function } = {}
const requestCharacterDetails: { [key: string]: Function } = {}
function pushToAckQueue(uuid: string, callback: Function) {
  ackQueue[uuid] = callback
}

function uuidv4() {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
  )
}

///////////////////////////////////////
// Setup Methods                     //
///////////////////////////////////////
async function setupSocketListenersForWorld(world: Ref<World>) {
  const socket = await getSocket()
  // const { refreshWorld } = useWorld()
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
    // let documentSource
    switch (args.type) {
      case 'Combat':
        processChanges(args, world.value.combats)
        break
      case 'Combatant': {
        const combatId = args.operation.parentUuid.split('.')?.[1]
        const combat = world.value?.combats.find((c: Combat) => c._id === combatId)
        processChanges(args, combat.combatants)
        break
      }
      case 'ChatMessage':
        processChanges(args, world.value.messages)
        break
      case 'User':
        console.log(args)
        break
    }
    // TODO: figure out if these refreshWorld calls are really necessary
    // refreshWorld()
  })
  socket.on('userActivity', (user: string, args: EventArgs) => {
    console.log(user, args)
    if (args.targets) {
      const { updateTargets } = useTargetHelper()
      updateTargets(user, args.targets)
    }
  })
}

async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<Actor | undefined>,
  refreshMethod: any
) {
  const socket = await getSocket()
  requestCharacterDetails[actorId] = refreshMethod
  socket.on('module.tablemate', (args: EventArgs) => {
    // if (!actor.value) return // why was this here?
    switch (args.action) {
      case 'listenerOnline':
        if (!parent.game) requestCharacterDetails[actorId]()
        break
      case 'updateCharacterDetails':
        parseActorData(actorId, actor, args)
        break
    }
  })
  socket.on('modifyDocument', (args: EventArgs) => {
    if (!actor.value) return
    switch (args.type) {
      case 'Actor':
        args.result.forEach((operation: any) => {
          if (operation._id === actorId) {
            merge(actor.value, operation)
            requestCharacterDetails[actorId]()
          }
        })
        break
      case 'Item':
        if (!actor.value) return
        if (args.operation.parentUuid === 'Actor.' + actorId) {
          processChanges(args, actor.value.items)
          requestCharacterDetails[actorId]()
        }
        break
    }
  })
}

///////////////////////////////////////
// Emit Methods                      //
///////////////////////////////////////
async function updateActor(
  actor: Ref<Actor>,
  update: {},
  additionalOptions: null | { [key: string]: any } = null
): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Actor',
        operation: {
          diff: true,
          render: true,
          updates: [
            {
              _id: actor.value!._id,
              ...update
            }
          ],
          ...additionalOptions
        }
      },
      (r: EventResponse) => {
        r.result.forEach((change: EventRequest) => {
          merge(actor.value, change)
          requestCharacterDetails[actor.value._id]()
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
  const promise = new Promise((resolve) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'Item',
        operation: {
          diff: true,
          render: true,
          parentUuid: 'Actor.' + actor.value?._id,
          updates: [
            {
              _id: itemId,
              ...update
            }
          ],
          ...additionalOptions
        }
      },
      (r: any) => {
        _processUpdates(actor.value.items, r.result)
        requestCharacterDetails[actor.value._id]()
        resolve(r)
      }
    )
  })
  return promise
}

async function deleteActorItem(actor: Ref<Actor>, itemId: string): Promise<any> {
  const socket = await getSocket()
  const promise = new Promise((resolve) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'delete',
        type: 'Item',
        operation: {
          ids: [itemId],
          parentUuid: 'Actor.' + actor.value?._id
        }
      },
      (r: any) => {
        _processDeletes(actor.value.items, r.result)
        requestCharacterDetails[actor.value._id]()
        resolve(r)
      }
    )
  })
  return promise
}

async function updateUserTargetingProxy(userId: string, proxyId: string) {
  const socket = await getSocket()
  const promise = new Promise((resolve) => {
    socket.emit(
      'modifyDocument',
      {
        action: 'update',
        type: 'User',
        operation: {
          updates: [
            {
              _id: userId,
              flags: { tablemate: { targeting_proxy: proxyId } }
            }
          ]
        }
      },
      (r: any) => {
        // _processDeletes(actor.value.items, r.result)
        // requestCharacterDetails[actor.value._id]()
        // TODO: add something here to update local data?
        resolve(r)
      }
    )
  })
  return promise
}

/////////////////////////////////////////////////
// Character Build Methods                     //
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
  // function customizer(objValue: any, srcValue: any, key: any, obj: any) {
  //   if (objValue !== srcValue && typeof srcValue === 'undefined') {
  //     obj[key] = srcValue
  //   }
  // }
  if (args.actorId === actorId) {
    // TODO: (refactor) this is tricky. rewriting the actor.value procs a huge number of calculations, but merging is unreliable and limited
    // if (!actor.value) actor.value = JSON.parse(args.actor)
    // else mergeWith(actor.value, JSON.parse(args.actor), customizer)
    actor.value = JSON.parse(args.actor)

    // todo: (refactor) is there any way avoid requiring these tedious things
    merge(actor.value!.system, JSON.parse(args.system))
    actor.value!.feats = JSON.parse(args.feats)
  }
}

///////////////////////////////////////
// Action Request                    //
///////////////////////////////////////
async function castSpell(
  actor: Ref<Actor>,
  spellId: string,
  castingLevel: number,
  castingSlot: number
): Promise<ResolutionArgs> {
  const { getTargets } = useTargetHelper()
  const uuid = uuidv4()
  const args = {
    action: 'castSpell',
    id: spellId,
    characterId: actor.value._id,
    targets: getTargets(),
    rank: castingLevel,
    slotId: castingSlot,
    uuid
  }
  if (parent.game) {
    return foundryCastSpell(args)
  } else {
    const socket = await getSocket()
    return new Promise((resolve) => {
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
  const { getTargets } = useTargetHelper()
  const uuid = uuidv4()
  const args = {
    action: 'rollCheck',
    characterId: actor.value._id,
    targets: getTargets(),
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
    return new Promise((resolve) => {
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
  const { getTargets } = useTargetHelper()
  console.log('here', getTargets())
  const uuid = uuidv4()
  const args = {
    action: 'characterAction',
    characterId: actor.value._id,
    targets: getTargets(),
    characterAction,
    options,
    uuid
  }
  if (parent.game) {
    return foundryCharacterAction(args)
  } else {
    const socket = await getSocket()
    return new Promise((resolve) => {
      socket.emit('module.tablemate', args)
      pushToAckQueue(uuid, (args: any) => resolve(args))
    })
  }
}

async function consumeItem(actor: Ref<Actor>, consumableId: string, options = {}) {
  const uuid = uuidv4()
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
    return new Promise((resolve) => {
      socket.emit('module.tablemate', args)
      pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
    })
  }
}

///////////////////////////////////////
// Processing Methods                //
///////////////////////////////////////
function processChanges(args: any, dataRoot: any) {
  switch (args.action) {
    case 'create':
      _processCreates(dataRoot, args.result as Item[])
      break
    case 'update':
      _processUpdates(dataRoot, args.result as Item[])
      break
    case 'delete':
      _processDeletes(dataRoot, args.result as string[])
      break
  }
}

function _processCreates(set: any[], results: Item[]) {
  results.forEach((c: Item) => {
    set.push(c)
  })
}
function _processUpdates(set: any[], results: Item[]) {
  results.forEach((change: Item) => {
    const item = set.find((a: any) => a._id === change._id)
    if (item) merge(item, change)
  })
}
function _processDeletes(set: any[], results: string[]) {
  results.forEach((d: string) => {
    const index = set.findIndex((i: any) => i._id === d)
    if (index != -1) {
      set.splice(index, 1)
    }
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
    updateUserTargetingProxy,
    castSpell,
    rollCheck,
    consumeItem,
    characterAction
  }
}
