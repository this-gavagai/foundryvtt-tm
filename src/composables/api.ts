import type { Ref } from 'vue'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import type { CharacterPF2e, GamePF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type {
  RequestResolutionArgs,
  ModuleEventArgs,
  UpdateCharacterDetailsArgs,
  CastSpellArgs,
  RollCheckArgs,
  CharacterActionArgs,
  ConsumeItemArgs,
  GetStrikeDamageArgs,
  SendItemToChatArgs,
  CallMacroArgs,
  DiceResults
} from '@/types/api-types'

type ModifyDocumentUpdate = { _id: string; [key: string]: unknown }
type DocumentData = { _id: string | null }

import { mergeWith } from 'lodash-es'
import { useServerStore } from '@/stores/server'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { logger, uuidv4 } from '@/utils/utilities'
import { useUserStore } from '@/stores/user'
import { useListenersStore } from '@/stores/listenersOnline'

const characterUnsynced = new Map<string, boolean>() // character document dirty state, update request pending
const characterLastRequest = new Map<string, string>() // latest character update request uuid

const refreshCallbacks: { [actorId: string]: Set<() => void> } = {}
function addRefresh(actorId: string, fn: () => void): () => void {
  ;(refreshCallbacks[actorId] ??= new Set()).add(fn)
  return () => {
    refreshCallbacks[actorId]?.delete(fn)
    if (refreshCallbacks[actorId]?.size === 0) delete refreshCallbacks[actorId]
  }
}
function fireRefresh(actorId: string | null | undefined) {
  if (!actorId) return
  refreshCallbacks[actorId]?.forEach((fn) => fn())
}
const getSocket = () => useServerStore().getSocket()
const getUserId = () => useUserStore().getUserId()
const ackQueue: { [key: string]: (args: RequestResolutionArgs) => void } = {}
const ACK_TIMEOUT_MS = 30_000
function pushToAckQueue(
  uuid: string,
  resolve: (args: RequestResolutionArgs) => void,
  reject: (err: Error) => void,
  timeoutMs = ACK_TIMEOUT_MS
) {
  const timer = setTimeout(() => {
    if (ackQueue[uuid]) {
      delete ackQueue[uuid]
      const message = `TM-WARN: request ${uuid} timed out after ${timeoutMs}ms`
      logger.warn(message)
      reject(new Error(message))
    }
  }, timeoutMs)
  ackQueue[uuid] = (args) => {
    clearTimeout(timer)
    resolve(args)
  }
}

function mergeWithArrayReset(objValue: unknown, srcValue: unknown) {
  if (Array.isArray(srcValue) && Array.isArray(objValue) && srcValue.length < objValue.length) {
    logger.warn('TM-WARN: nuking array due to length mismatch', objValue, srcValue)
    return srcValue
  }
}

///////////////////////////////////////
// Setup Methods                     //
///////////////////////////////////////
async function setupSocketListenersForApp() {
  const socket = await getSocket()
  const { addListener } = useListenersStore()
  socket.on('module.tablemate', (args: ModuleEventArgs) => {
    switch (args.action) {
      case 'acknowledged':
        if (ackQueue[args.uuid]) {
          ackQueue[args.uuid](args)
          delete ackQueue[args.uuid]
        }
        break
      case 'shareTargets':
        const { updateTargets } = useTargetHelperStore()
        Object.entries(args.targets).forEach(([userId, targets]) =>
          updateTargets(userId, targets as string[])
        )
        break
      case 'listenerOnline':
        logger.info('listener online!', args)
        addListener(args.userId)
        break
    }
  })
}
async function setupSocketListenersForWorld(world: Ref<GamePF2e>) {
  const socket = await getSocket()

  socket.on('modifyDocument', (args: DocumentSocketResponse) => {
    switch (args.type) {
      case 'Combat':
        processChanges(args, world.value.combats as unknown as DocumentData[])
        break
      case 'Combatant': {
        const combatId = args.operation.parentUuid?.split('.')?.[1]
        const combat = world.value?.combats.find((c) => c._id === combatId)
        processChanges(args, combat?.combatants as unknown as DocumentData[] | undefined)
        break
      }
      case 'ChatMessage':
        processChanges(args, world.value?.messages as unknown as DocumentData[] | undefined)
        break
    }
  })
  socket.on('userActivity', (user: string, args: { targets?: string[]; active?: boolean }) => {
    if (args.targets) {
      logger.info('user event', user, args)
      const { updateTargets } = useTargetHelperStore()
      updateTargets(user, args.targets)
    } else if (args.active) {
      logger.info('user online', user, args)
    }
  })
}

async function setupSocketListenersForActor(
  actorId: string,
  actor: Ref<TablemateCharacter | undefined>,
  refreshMethod: () => Promise<void>
): Promise<() => void> {
  const socket = await getSocket()
  const removeRefresh = addRefresh(actorId, refreshMethod)
  socket.on('module.tablemate', (args: ModuleEventArgs) => {
    switch (args.action) {
      case 'listenerOnline':
        if (!actor.value?.inventory) fireRefresh(actorId)
        break
      case 'updateCharacterDetails':
        parseActorData(actorId, actor, args)
        break
    }
  })
  socket.on('modifyDocument', (args: DocumentSocketResponse) => {
    if (!actor.value) return
    switch (args.type) {
      case 'Actor':
        ;(args.result as ModifyDocumentUpdate[]).forEach((result: ModifyDocumentUpdate) => {
          if (result._id === actorId) {
            mergeWith(actor.value, result, mergeWithArrayReset)
            fireRefresh(actorId)
          }
        })
        break
      case 'Item':
        if (args.operation.parentUuid === 'Actor.' + actorId) {
          processChanges(args, actor.value.items as unknown as DocumentData[])
          fireRefresh(actorId)
        }
        break
    }
  })
  return removeRefresh
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
  actor: Ref<TablemateCharacter | undefined>,
  args: UpdateCharacterDetailsArgs
) {
  if (actorId !== args.actorId) return
  if (characterUnsynced.get(actorId)) return
  if (characterLastRequest.get(actorId) !== args.uuid) return

  if (!actor.value) actor.value = {} as TablemateCharacter

  const incoming: Partial<TablemateCharacter> = {
    ...(args.actor as Partial<TablemateCharacter>),
    system: args.system as TablemateCharacter['system'],
    elementalBlasts: (args.elementalBlasts ?? undefined) as TablemateCharacter['elementalBlasts'],
    inventory: args.inventory as TablemateCharacter['inventory'],
    activeRules: args.activeRules
  }

  mergeWith(actor.value, incoming, mergeWithArrayReset)
}

///////////////////////////////////////
// Emit Methods                      //
///////////////////////////////////////
async function modifyDocument(
  payload: { action: string; type: string; operation: object },
  onResponse?: (r: DocumentSocketResponse) => void
): Promise<DocumentSocketResponse> {
  const socket = await getSocket()
  return new Promise<DocumentSocketResponse>((resolve) => {
    socket.emit('modifyDocument', payload, (r: DocumentSocketResponse) => {
      onResponse?.(r)
      resolve(r)
    })
  })
}

function updateActor(actor: Ref<CharacterPF2e>, update: object) {
  return modifyDocument(
    {
      action: 'update',
      type: 'Actor',
      operation: {
        diff: true,
        render: true,
        updates: [{ _id: actor.value._id, ...update }]
      }
    },
    (r) => {
      ;(r.result as ModifyDocumentUpdate[]).forEach((change) => {
        mergeWith(actor.value, change, mergeWithArrayReset)
      })
      fireRefresh(actor.value._id)
    }
  )
}

function updateActorItem(
  actor: Ref<CharacterPF2e>,
  itemId: string | string[],
  update: object | object[]
) {
  const itemIds = Array.isArray(itemId) ? itemId : [itemId]
  return modifyDocument(
    {
      action: 'update',
      type: 'Item',
      operation: {
        diff: true,
        render: true,
        parentUuid: 'Actor.' + actor.value._id,
        updates: itemIds.map((id, i) => ({
          _id: id,
          ...(Array.isArray(update) ? update[i] : update)
        }))
      }
    },
    (r) => {
      processChanges(r, actor.value.items as unknown as DocumentData[])
      fireRefresh(actor.value._id)
    }
  )
}

function deleteActorItem(actor: Ref<CharacterPF2e>, itemId: string) {
  return modifyDocument(
    {
      action: 'delete',
      type: 'Item',
      operation: {
        ids: [itemId],
        parentUuid: 'Actor.' + actor.value._id
      }
    },
    (r) => {
      processChanges(r, actor.value.items as unknown as DocumentData[])
      fireRefresh(actor.value._id)
    }
  )
}

function updateUserTargetingProxy(userId: string, proxyId: string) {
  return modifyDocument({
    action: 'update',
    type: 'User',
    operation: {
      updates: [{ _id: userId, flags: { tablemate: { targeting_proxy: proxyId } } }]
    }
  })
}

///////////////////////////////////////
// Action Request                    //
///////////////////////////////////////
async function sendModuleRequest<T extends { action: string }>(
  payload: Omit<T, 'userId' | 'uuid'>,
  timeoutMs?: number
): Promise<RequestResolutionArgs> {
  const uuid = uuidv4()
  const args = { ...payload, userId: getUserId(), uuid }
  const socket = await getSocket()
  return new Promise<RequestResolutionArgs>((resolve, reject) => {
    socket.emit('module.tablemate', args)
    pushToAckQueue(uuid, resolve, reject, timeoutMs)
  })
}

function castSpell(
  actor: Ref<CharacterPF2e>,
  spellId: string,
  castingLevel: number,
  castingSlot: number
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<CastSpellArgs>({
    action: 'castSpell',
    id: spellId,
    characterId: actor.value._id!,
    targets: useTargetHelperStore().getTargets(),
    rank: castingLevel,
    slotId: castingSlot
  })
}

function rollCheck(
  actor: Ref<CharacterPF2e>,
  checkType: string,
  checkSubtype = '',
  diceResults: DiceResults = {},
  modifiers: { label: string; modifier: number; enabled: boolean; ignored: boolean }[] = [],
  options = {},
  item = null
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<RollCheckArgs>({
    action: 'rollCheck',
    characterId: actor.value._id!,
    targets: useTargetHelperStore().getTargets(),
    item,
    checkType,
    checkSubtype,
    modifiers,
    diceResults,
    options
  })
}

function characterAction(
  actor: Ref<CharacterPF2e>,
  characterAction: string,
  options = {},
  diceResults: DiceResults = {}
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<CharacterActionArgs>({
    action: 'characterAction',
    characterId: actor.value._id!,
    targets: useTargetHelperStore().getTargets(),
    characterAction,
    diceResults,
    options
  })
}

function consumeItem(
  actor: Ref<CharacterPF2e>,
  consumableId: string,
  options = {}
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<ConsumeItemArgs>({
    action: 'consumeItem',
    characterId: actor.value._id!,
    consumableId,
    options
  })
}

function getStrikeDamage(
  actor: Ref<CharacterPF2e>,
  actionSlug: string,
  altUsage: number | undefined = undefined
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<GetStrikeDamageArgs>({
    action: 'getStrikeDamage',
    characterId: actor.value._id!,
    targets: useTargetHelperStore().getTargets(),
    actionSlug,
    altUsage
  })
}

function sendItemToChat(characterId: string, itemId: string): Promise<RequestResolutionArgs> {
  return sendModuleRequest<SendItemToChatArgs>({
    action: 'sendItemToChat',
    characterId,
    itemId
  })
}

function callMacro(
  characterId: string | undefined,
  compendiumName: string | null = null,
  macroName: string | null = null,
  macroUuid: string | null = null,
  options = {}
): Promise<RequestResolutionArgs | null> {
  if (characterId === undefined) return Promise.resolve(null)
  return sendModuleRequest<CallMacroArgs>({
    action: 'callMacro',
    characterId,
    targets: useTargetHelperStore().getTargets(),
    compendiumName,
    macroName,
    macroUuid,
    options
  })
}

//////////////////////////////////////////////////
// Processing Methods for Items (not Actor)     //
//////////////////////////////////////////////////
function processChanges(args: DocumentSocketResponse, root: DocumentData[] | undefined) {
  if (!root) return
  switch (args.action) {
    case 'create':
      ;(args.result as ModifyDocumentUpdate[]).forEach((c) => root.push(c))
      break
    case 'update':
      ;(args.result as ModifyDocumentUpdate[]).forEach((change) => {
        const item = root.find((a) => a._id === change._id)
        if (item) mergeWith(item, change, mergeWithArrayReset)
      })
      break
    case 'delete':
      ;(args.result as string[]).forEach((id) => {
        const i = root.findIndex((x) => x._id === id)
        if (i !== -1) root.splice(i, 1)
      })
      break
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
    sendItemToChat,
    callMacro,
    setCharUnsynced: (actorId: string, value: boolean) => characterUnsynced.set(actorId, value),
    isCharUnsynced: (actorId: string) => characterUnsynced.get(actorId) ?? false
  }
}
