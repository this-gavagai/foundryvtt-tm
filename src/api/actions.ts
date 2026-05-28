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
  SetWeaponLoadedArgs,
  SetWeaponDamageTypeArgs,
  ToggleKineticAuraArgs,
  CastStaffSpellArgs,
  DiceResults,
  CheckModifier
} from '@/types/api-types'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { logger, uuidv4 } from '@/utils/utilities'
import { getSocket, getUserId } from './internal'
import { TM } from './protocol'

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
    socket.emit(TM.CHANNEL, args)
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
    action: TM.CAST_SPELL,
    id: spellId,
    characterId: actor.value._id!,
    targets: useTargetHelperStore().getTargets(),
    rank: castingLevel,
    slotId: castingSlot
  })
}

export function castStaffSpell(
  actor: Ref<CharacterPF2e>,
  staffId: string,
  spellId: string,
  rank: number
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<CastStaffSpellArgs>({
    action: TM.CAST_STAFF_SPELL,
    characterId: actor.value._id!,
    staffId,
    spellId,
    rank,
    targets: useTargetHelperStore().getTargets()
  })
}

export function rollCheck(
  actor: Ref<CharacterPF2e>,
  checkType: string,
  checkSubtype = '',
  diceResults: DiceResults = {},
  modifiers: CheckModifier[] = [],
  options = {},
  item = null
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<RollCheckArgs>({
    action: TM.ROLL_CHECK,
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
    action: TM.CHARACTER_ACTION,
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
    action: TM.CONSUME_ITEM,
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
    action: TM.GET_STRIKE_DAMAGE,
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
    action: TM.SEND_ITEM_TO_CHAT,
    characterId,
    itemId
  })
}

export function setWeaponLoaded(
  actor: Ref<CharacterPF2e>,
  weaponId: string,
  loaded: boolean,
  ammoId: string | null = null
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<SetWeaponLoadedArgs>({
    action: TM.SET_WEAPON_LOADED,
    characterId: actor.value._id!,
    weaponId,
    loaded,
    ammoId
  })
}

export function setWeaponDamageType(
  actor: Ref<CharacterPF2e>,
  weaponId: string,
  trait: 'versatile' | 'modular',
  selected: string | null
): Promise<RequestResolutionArgs> {
  return sendModuleRequest<SetWeaponDamageTypeArgs>({
    action: TM.SET_WEAPON_DAMAGE_TYPE,
    characterId: actor.value._id!,
    weaponId,
    trait,
    selected
  })
}

export function toggleKineticAura(actor: Ref<CharacterPF2e>): Promise<RequestResolutionArgs> {
  return sendModuleRequest<ToggleKineticAuraArgs>({
    action: TM.TOGGLE_KINETIC_AURA,
    characterId: actor.value._id!
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
    action: TM.CALL_MACRO,
    characterId,
    targets: useTargetHelperStore().getTargets(),
    compendiumName,
    macroName,
    macroUuid,
    options
  })
}
