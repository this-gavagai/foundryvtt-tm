import type { Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type {
  ModuleEventArgs,
  RequestResolutionArgs,
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

// Strongly-typed action dispatcher. Given a TM action constant, infers the
// matching args interface from the ModuleEventArgs union via `Extract`, so
// the payload object is type-checked against the right shape without an
// explicit `<XArgs>` generic at the call site.
async function sendAction<K extends ModuleEventArgs['action']>(
  action: K,
  payload: Omit<Extract<ModuleEventArgs, { action: K }>, 'action' | 'userId' | 'uuid'>,
  timeoutMs?: number
): Promise<RequestResolutionArgs> {
  const uuid = uuidv4()
  const args = { ...payload, action, userId: getUserId(), uuid }
  const socket = await getSocket()
  return new Promise<RequestResolutionArgs>((resolve, reject) => {
    pushToAckQueue(uuid, resolve, reject, timeoutMs)
    socket.emit(TM.CHANNEL, args)
  })
}

// Common payload prefixes. Every action needs characterId; most "interactive"
// actions also need the current target set.
const fromActor = (a: Ref<CharacterPF2e>) => ({ characterId: a.value._id! })
const fromActorTargeted = (a: Ref<CharacterPF2e>) => ({
  characterId: a.value._id!,
  targets: useTargetHelperStore().getTargets()
})

export const castSpell = (
  actor: Ref<CharacterPF2e>,
  spellId: string,
  castingLevel: number,
  castingSlot: number
) =>
  sendAction(TM.CAST_SPELL, {
    ...fromActorTargeted(actor),
    id: spellId,
    rank: castingLevel,
    slotId: castingSlot
  })

export const castStaffSpell = (
  actor: Ref<CharacterPF2e>,
  staffId: string,
  spellId: string,
  rank: number
) =>
  sendAction(TM.CAST_STAFF_SPELL, {
    ...fromActorTargeted(actor),
    staffId,
    spellId,
    rank
  })

export const rollCheck = (
  actor: Ref<CharacterPF2e>,
  checkType: string,
  checkSubtype = '',
  diceResults: DiceResults = {},
  modifiers: CheckModifier[] = [],
  options = {},
  item = null
) =>
  sendAction(TM.ROLL_CHECK, {
    ...fromActorTargeted(actor),
    item,
    checkType,
    checkSubtype,
    modifiers,
    diceResults,
    options
  })

export const characterAction = (
  actor: Ref<CharacterPF2e>,
  characterAction: string,
  options = {},
  diceResults: DiceResults = {}
) =>
  sendAction(TM.CHARACTER_ACTION, {
    ...fromActorTargeted(actor),
    characterAction,
    diceResults,
    options
  })

export const consumeItem = (
  actor: Ref<CharacterPF2e>,
  consumableId: string,
  options = {}
) =>
  sendAction(TM.CONSUME_ITEM, {
    ...fromActor(actor),
    consumableId,
    options
  })

export const getStrikeDamage = (
  actor: Ref<CharacterPF2e>,
  actionSlug: string,
  altUsage: number | undefined = undefined
) =>
  sendAction(TM.GET_STRIKE_DAMAGE, {
    ...fromActorTargeted(actor),
    actionSlug,
    altUsage
  })

export const getSpellDamage = (
  actor: Ref<CharacterPF2e>,
  spellId: string,
  castingRank: number | undefined = undefined
) =>
  sendAction(TM.GET_SPELL_DAMAGE, {
    ...fromActorTargeted(actor),
    spellId,
    castingRank
  })

// Free-form damage roll from an inline @Damage[...] link in a description.
// Formula is already client-resolved (@item.level etc. substituted by
// ParsedDescription). The optional itemId lets the Foundry handler look up
// the source item and delegate chat-card rendering to PF2e's inline-roll
// pipeline so the post matches a native click on the same @Damage anchor.
export const rollFreeDamage = (
  actor: Ref<CharacterPF2e>,
  formula: string,
  result: DiceResults = {},
  itemId?: string,
  damageInline?: Record<string, string | true>
) =>
  sendAction(TM.ROLL_CHECK, {
    ...fromActorTargeted(actor),
    item: null,
    checkType: 'freeDamage',
    checkSubtype: formula,
    modifiers: [],
    diceResults: result,
    options: { itemId, damageInline }
  })

export const sendItemToChat = (characterId: string, itemId: string) =>
  sendAction(TM.SEND_ITEM_TO_CHAT, { characterId, itemId })

export const setWeaponLoaded = (
  actor: Ref<CharacterPF2e>,
  weaponId: string,
  loaded: boolean,
  ammoId: string | null = null
) =>
  sendAction(TM.SET_WEAPON_LOADED, {
    ...fromActor(actor),
    weaponId,
    loaded,
    ammoId
  })

export const setWeaponDamageType = (
  actor: Ref<CharacterPF2e>,
  weaponId: string,
  trait: 'versatile' | 'modular',
  selected: string | null
) =>
  sendAction(TM.SET_WEAPON_DAMAGE_TYPE, {
    ...fromActor(actor),
    weaponId,
    trait,
    selected
  })

export const toggleKineticAura = (actor: Ref<CharacterPF2e>) =>
  sendAction(TM.TOGGLE_KINETIC_AURA, fromActor(actor))

export const freeRoll = (
  characterId: string,
  secret: boolean,
  face?: number,
  damageFormula?: string,
  damageResult?: DiceResults,
  traits?: string[]
) =>
  sendAction(TM.FREE_ROLL, {
    characterId,
    secret,
    diceResults: damageFormula ? (damageResult ?? {}) : { d20: [face ?? 0] },
    ...(damageFormula ? { damageFormula } : {}),
    ...(traits && traits.length ? { traits } : {})
  })

export function callMacro(
  characterId: string | undefined,
  compendiumName: string | null = null,
  macroName: string | null = null,
  macroUuid: string | null = null,
  options = {}
): Promise<RequestResolutionArgs | null> {
  if (characterId === undefined) return Promise.resolve(null)
  return sendAction(TM.CALL_MACRO, {
    characterId,
    targets: useTargetHelperStore().getTargets(),
    compendiumName,
    macroName,
    macroUuid,
    options
  })
}
