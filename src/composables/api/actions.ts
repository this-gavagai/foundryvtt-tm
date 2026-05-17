import type { Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type {
  RequestResolutionArgs,
  CastSpellArgs,
  RollCheckArgs,
  CharacterActionArgs,
  ConsumeItemArgs,
  GetStrikeDamageArgs,
  SendItemToChatArgs,
  CallMacroArgs,
  DiceResults
} from '@/types/api-types'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { logger, uuidv4 } from '@/utils/utilities'
import { getSocket, getUserId } from './internal'

// Pending ack queue: uuid → resolver. Populated when an action RPC is sent,
// drained either by resolveAck() when the server acknowledges or by the
// timeout below.
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

// Called by the socket listener when the server sends an 'acknowledged' event.
// Resolves the matching pending request, if any.
export function resolveAck(uuid: string, args: RequestResolutionArgs) {
  if (ackQueue[uuid]) {
    ackQueue[uuid](args)
    delete ackQueue[uuid]
  }
}

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

export function castSpell(
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

export function rollCheck(
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

export function characterAction(
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

export function consumeItem(
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

export function getStrikeDamage(
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

export function sendItemToChat(
  characterId: string,
  itemId: string
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<SendItemToChatArgs>({
    action: 'sendItemToChat',
    characterId,
    itemId
  })
}

export function callMacro(
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
