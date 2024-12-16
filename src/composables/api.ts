// TODO (upstream): this thing isn't triggering preUpdateActor hooks, as those are conventionally called only on the actor in question. Solution unknown
// TODO (UX): need some way to indicate that gm-dependent methods aren't available when that's the case
import type { Ref } from 'vue'
import type { Actor, World, Item, Combat, System, ElementalBlasts } from '@/types/pf2e-types'
import type {
  ResolutionArgs,
  ModuleEventArgs,
  UpdateCharacterDetailsArgs,
  CastSpellArgs,
  RollCheckArgs,
  CharacterActionArgs,
  ConsumeItemArgs,
  GetStrikeDamageArgs
} from '@/types/api-types'
import type {
  DocumentEventArgs,
  UpdateEventArgs,
  DeleteEventArgs,
  ModifyDocumentUpdate,
  UserActivityEventArgs
} from '@/types/foundry-types'

import { mergeWith } from 'lodash-es'
import { useServer } from '@/composables/server'
import { useTargetHelper } from '@/composables/targetHelper'
import { uuidv4 } from '@/utils/utilities'
import { useUserId } from '@/composables/user'
// import { useWorld } from '@/composables/world'

const characterUnsynced = new Map<string, boolean>() // character document dirty state, update request pending
// const getCharUnsynced =
const characterLastRequest = new Map<string, string>() // latest character update request uuid
// const getCharLastRequest =

const { getSocket } = useServer()
// TODO (types): not really unknown/void; identify and improve (see action returns for details) audit all other unknowns in codebase
const requestCharacterDetails: { [key: string]: () => Promise<unknown> } = {}
const ackQueue: { [key: string]: (args: ResolutionArgs) => unknown } = {}
function pushToAckQueue(uuid: string, callback: (args: ResolutionArgs) => unknown) {
  ackQueue[uuid] = callback
}
const { getUserId } = useUserId()

///////////////////////////////////////
// Setup Methods                     //
///////////////////////////////////////
async function setupSocketListenersForApp() {
  const socket = await getSocket()
  socket.on('module.tablemate', (args: ModuleEventArgs) => {
    switch (args.action) {
      case 'acknowledged':
        // console.log('here args', args.uuid)
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid](args)
          delete ackQueue[args.uuid]
        }
        break
      case 'shareTarget':
        const { updateTargets } = useTargetHelper()
        updateTargets(args.userId, args.targets)
        break
    }
  })
}
async function setupSocketListenersForWorld(world: Ref<World>) {
  const socket = await getSocket()
  socket.on('modifyDocument', (args: DocumentEventArgs) => {
    // let documentSource
    switch (args.type) {
      case 'Combat':
        processChanges(args, world.value.combats)
        break
      case 'Combatant': {
        const combatId = args.operation.parentUuid?.split('.')?.[1]
        const combat = world.value?.combats.find((c: Combat) => c._id === combatId)
        processChanges(args, combat.combatants)
        break
      }
      case 'ChatMessage':
        processChanges(args, world.value?.messages)
        break
      case 'User':
        console.log(args)
        break
    }
  })
  socket.on('userActivity', (user: string, args: UserActivityEventArgs) => {
    if (args.targets) {
      const { updateTargets } = useTargetHelper()
      updateTargets(user, args.targets)
    }
  })
  const userId = getUserId()
  socket?.emit('module.tablemate', { userId, action: 'anybodyHome' })
}

async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<Actor | undefined>,
  refreshMethod: () => Promise<void>
) {
  const socket = await getSocket()
  requestCharacterDetails[actorId] = refreshMethod
  socket.on('module.tablemate', (args: ModuleEventArgs) => {
    switch (args.action) {
      case 'listenerOnline':
        if (!parent.game) requestCharacterDetails[actorId]()
        break
      case 'updateCharacterDetails':
        parseActorData(actorId, actor, args)
        break
    }
  })
  socket.on('modifyDocument', (args: DocumentEventArgs) => {
    if (!actor.value) return
    switch (args.type) {
      case 'Actor':
        ;(args as UpdateEventArgs).result.forEach((result: ModifyDocumentUpdate) => {
          if (actor.value && result._id === actorId) {
            mergeWith(actor.value, result, resetArrays)
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

/////////////////////////////////////////////////
// Character Build Methods                     //
/////////////////////////////////////////////////

async function sendCharacterRequest(actorId: string): Promise<void> {
  const socket = await getSocket()
  const userId = getUserId()
  const uuid = uuidv4()
  socket.emit('module.tablemate', {
    userId,
    action: 'requestCharacterDetails',
    actorId: actorId,
    uuid
  })
  characterUnsynced.set(actorId, false)
  characterLastRequest.set(actorId, uuid)
}
function parseActorData(
  actorId: string,
  actor: Ref<Actor | undefined>,
  args: UpdateCharacterDetailsArgs
) {
  if (actorId !== args.actorId) return
  if (characterUnsynced.get(actorId)) return
  if (characterLastRequest.get(actorId) !== args.uuid) return

  if (!actor.value) actor.value = {} as Actor
  if (!actor.value.system) actor.value.system = {} as System
  if (!actor.value.elementalBlasts)
    actor.value.elementalBlasts = {} as ElementalBlasts

    // TODO (optimization): still getting the update nuke on languages for some reason
  ;(function () {
    mergeWith(actor.value, JSON.parse(args.actor), resetArrays)
    mergeWith(actor.value!.system, JSON.parse(args.system), resetArrays)
    mergeWith(actor.value!.elementalBlasts, JSON.parse(args.elementalBlasts), resetArrays)
  })()
}

///////////////////////////////////////
// Emit Methods                      //
///////////////////////////////////////
async function updateActor(actor: Ref<Actor | undefined>, update: object) {
  if (!actor.value) return
  const socket = await getSocket()
  const promise = new Promise<DocumentEventArgs>((resolve) => {
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
          ]
        }
      },
      (r: UpdateEventArgs) => {
        r.result.forEach((change: ModifyDocumentUpdate) => {
          if (actor.value) mergeWith(actor.value, change, resetArrays)
        })
        requestCharacterDetails[actor.value!._id]()
        resolve(r)
      }
    )
  })
  return promise
}

async function updateActorItem(
  actor: Ref<Actor>,
  itemId: string | string[],
  update: object | object[]
) {
  const socket = await getSocket()
  const itemIdArray = Array.isArray(itemId) ? itemId : [itemId]
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
            ...itemIdArray.map((itemId, index) => ({
              _id: itemId,
              ...(Array.isArray(update) ? update[index] : update)
            }))
          ]
        }
      },
      (r: UpdateEventArgs) => {
        processChanges(r, actor.value.items)
        requestCharacterDetails[actor.value._id]()
        resolve(r)
      }
    )
  })
  return promise
}

async function deleteActorItem(actor: Ref<Actor>, itemId: string) {
  const socket = await getSocket()
  const promise = new Promise<DeleteEventArgs>((resolve) => {
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
      (r: DeleteEventArgs) => {
        processChanges(r, actor.value.items)
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
      (r: DocumentEventArgs) => {
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
): Promise<ResolutionArgs> {
  const { getTargets } = useTargetHelper()
  const userId = getUserId()
  const uuid = uuidv4()
  const args: CastSpellArgs = {
    userId,
    action: 'castSpell',
    id: spellId,
    characterId: actor.value._id,
    targets: getTargets(),
    rank: castingLevel,
    slotId: castingSlot,
    uuid
  }

  const socket = await getSocket()
  return new Promise((resolve) => {
    socket.emit('module.tablemate', args)
    pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
  })
}

async function rollCheck(
  actor: Ref<Actor>,
  checkType: string,
  checkSubtype = '',
  modifiers = [],
  options = {}
): Promise<ResolutionArgs> {
  const { getTargets } = useTargetHelper()
  const userId = getUserId()
  const uuid = uuidv4()
  const args: RollCheckArgs = {
    userId,
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

  const socket = await getSocket()
  return new Promise((resolve) => {
    socket.emit('module.tablemate', args)
    pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
  })
}

async function characterAction(
  actor: Ref<Actor>,
  characterAction: string,
  options = {}
): Promise<ResolutionArgs> {
  const { getTargets } = useTargetHelper()
  const userId = getUserId()
  const uuid = uuidv4()
  const args: CharacterActionArgs = {
    userId,
    action: 'characterAction',
    characterId: actor.value._id,
    targets: getTargets(),
    characterAction,
    options,
    uuid
  }

  const socket = await getSocket()
  return new Promise((resolve) => {
    socket.emit('module.tablemate', args)
    pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
  })
}

async function consumeItem(
  actor: Ref<Actor>,
  consumableId: string,
  options = {}
): Promise<ResolutionArgs> {
  const uuid = uuidv4()
  const userId = getUserId()
  const args: ConsumeItemArgs = {
    userId,
    action: 'consumeItem',
    characterId: actor.value._id,
    consumableId,
    options,
    uuid
  }
  const socket = await getSocket()
  return new Promise((resolve) => {
    socket.emit('module.tablemate', args)
    pushToAckQueue(uuid, (args: ResolutionArgs) => resolve(args))
  })
}
async function getStrikeDamage(
  actor: Ref<Actor>,
  actionSlug: string,
  altUsage: number | undefined = undefined
): Promise<ResolutionArgs> {
  const { getTargets } = useTargetHelper()
  const userId = getUserId()
  const uuid = uuidv4()
  const args: GetStrikeDamageArgs = {
    userId,
    action: 'getStrikeDamage',
    characterId: actor.value._id,
    targets: getTargets(),
    actionSlug: actionSlug,
    altUsage,
    uuid
  }
  const socket = await getSocket()
  return new Promise((resolve) => {
    socket.emit('module.tablemate', args)
    pushToAckQueue(uuid, (args: ResolutionArgs) => {
      resolve(args)
    })
  })
}

//////////////////////////////////////////////////
// Processing Methods for Items (not Actor)     //
//////////////////////////////////////////////////
function processChanges(args: DocumentEventArgs, dataRoot: Item[]) {
  switch (args.action) {
    case 'create':
      _processCreates(args.result, dataRoot)
      break
    case 'update':
      _processUpdates(args.result, dataRoot)
      break
    case 'delete':
      _processDeletes(args.result, dataRoot)
      break
  }
}

function _processCreates(results: ModifyDocumentUpdate[], root: Item[]) {
  results.forEach((c: ModifyDocumentUpdate) => {
    root.push(c as Item)
  })
}
function _processUpdates(results: ModifyDocumentUpdate[], root: Item[]) {
  results.forEach((change: ModifyDocumentUpdate) => {
    const item = root.find((a: Item) => a._id === change._id)
    if (item) mergeWith(item, change, resetArrays)
  })
}
function _processDeletes(results: string[], root: Item[]) {
  results.forEach((d: string) => {
    const index = root.findIndex((i: Item) => i._id === d)
    if (index != -1) {
      root.splice(index, 1)
    }
  })
}
function resetArrays(objValue: unknown, srcValue: unknown) {
  if (Array.isArray(srcValue) && Array.isArray(objValue) && srcValue.length < objValue.length) {
    console.log('TM: nuking array due to length mismatch', objValue, srcValue)
    return srcValue
  }
}

///////////////////////////////////////
// Export                            //
///////////////////////////////////////
export function useApi() {
  return {
    setupSocketListenersForApp,
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
    characterAction,
    getStrikeDamage,
    getCharUnsynced: () => characterUnsynced,
    getCharLastRequest: () => characterUnsynced
  }
}
