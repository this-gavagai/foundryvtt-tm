import type { ItemPF2e, RawModifier } from '@7h3laughingman/pf2e-types'
import type { TM } from '@/api/protocol'

export type ModuleEventArgs =
  | AcknowledgementArgs
  | ListenderOnlineArgs
  | UpdateCharacterDetailsArgs
  | RequestCharacterDetailsArgs
  | AnybodyHomeArgs
  | RollCheckArgs
  | CharacterActionArgs
  | CastSpellArgs
  | ConsumeItemArgs
  | GetStrikeDamageArgs
  | ShareTargetsArgs
  | SendItemToChatArgs
  | CallMacroArgs
  | SetWeaponLoadedArgs
  | ToggleKineticAuraArgs

export interface AcknowledgementArgs {
  action: typeof TM.ACK
  uuid: string
  userId: string
}
export interface ListenderOnlineArgs {
  action: typeof TM.LISTENER_ONLINE
  userId: string
}
export interface UpdateCharacterDetailsArgs {
  action: typeof TM.UPDATE_CHARACTER
  actorId: string
  // Fields below are sent as live objects (not pre-stringified). socket.io
  // handles wire serialization itself; the Foundry side runs a single
  // JSON.parse(JSON.stringify(...)) pass on elementalBlasts only, to break
  // its circular `actor` reference and shrink nested `item` references.
  actor: object
  system: object
  languages: string[]
  proficiencyLabels: Record<string, string>
  inventory: object
  activeRules: string[]
  elementalBlasts: object | null
  spellcastingModifiers: Record<string, object>
  rollOptionLabels: Record<string, string>
  uuid: string
  userId: string
}
export interface RequestCharacterDetailsArgs {
  action: typeof TM.REQUEST_CHARACTER
  userId: string
  actorId: string
  uuid: string
}
export interface AnybodyHomeArgs {
  action: typeof TM.ANYBODY_HOME
  userId: string
}
export interface CheckModifier {
  label: string
  modifier: number
  enabled: boolean
  ignored: boolean
}

export interface RollCheckArgs {
  action: typeof TM.ROLL_CHECK
  userId: string
  characterId: string
  checkType: string
  checkSubtype: string
  modifiers: CheckModifier[]
  options: object
  uuid: string
  targets?: string[]
  item?: ItemPF2e | null
  diceResults: DiceResults
}
export interface CharacterActionArgs {
  action: typeof TM.CHARACTER_ACTION
  userId: string
  characterId: string
  targets: string[]
  characterAction: string
  diceResults: DiceResults
  options: object
  uuid: string
}
export interface CastSpellArgs {
  action: typeof TM.CAST_SPELL
  userId: string
  id: string
  characterId: string
  rank: number
  slotId: number
  uuid: string
  targets: string[]
}
export interface ConsumeItemArgs {
  action: typeof TM.CONSUME_ITEM
  userId: string
  characterId: string
  consumableId: string
  options: object
  uuid: string
}
export interface GetStrikeDamageArgs {
  action: typeof TM.GET_STRIKE_DAMAGE
  userId: string
  characterId: string
  actionSlug: string
  targets: string[]
  altUsage: number | undefined
  uuid: string
}
export interface ShareTargetsArgs {
  action: typeof TM.SHARE_TARGETS
  targets: Record<string, string[]>
  userId: string
}
export interface SendItemToChatArgs {
  action: typeof TM.SEND_ITEM_TO_CHAT
  userId: string
  characterId: string
  itemId: string
  uuid: string
}
export interface CallMacroArgs {
  action: typeof TM.CALL_MACRO
  userId: string
  characterId: string
  targets: string[]
  compendiumName: string | null
  macroName: string | null
  macroUuid: string | null
  options: object
  uuid: string
}
export interface SetWeaponLoadedArgs {
  action: typeof TM.SET_WEAPON_LOADED
  userId: string
  characterId: string
  weaponId: string
  loaded: boolean
  ammoId?: string | null
  uuid: string
}
export interface ToggleKineticAuraArgs {
  action: typeof TM.TOGGLE_KINETIC_AURA
  userId: string
  characterId: string
  uuid: string
}

export interface RollResult {
  formula: string
  result: string
  total: number
  dice: DiceResults
  isSecret: boolean
}

export interface RequestResolutionArgs {
  action: typeof TM.ACK
  uuid: string
  roll?: RollResult
  response?: {
    damage?: string
    critical?: string
    modifiers?: RawModifier[]
  }
}

export interface ActiveRoll {
  action: 'action' | 'check'
  slug?: string
  label?: string
  paramsString?: string
  params?: Record<string, string>
  dc?: number
}

export interface DiceResults {
  d4?: number[]
  d6?: number[]
  d8?: number[]
  d10?: number[]
  d12?: number[]
  d20?: number[]
  d100?: number[]
}

// debugging conveniences
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altActors: any
    altCharacters: any
    link: any
    game: any
    Hooks: any
    character: any
    getBlastData: any
    pixel: any
    __TM_ENV__: any
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
