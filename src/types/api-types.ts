import type { ItemPF2e, RawModifier } from '@7h3laughingman/pf2e-types'

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

export interface AcknowledgementArgs {
  action: 'acknowledged'
  uuid: string
  userId: string
}
export interface ListenderOnlineArgs {
  action: 'listenerOnline'
  userId: string
}
export interface UpdateCharacterDetailsArgs {
  action: 'updateCharacterDetails'
  actorId: string
  // Fields below are sent as live objects (not pre-stringified). socket.io
  // handles wire serialization itself; the Foundry side runs a single
  // JSON.parse(JSON.stringify(...)) pass on elementalBlasts only, to break
  // its circular `actor` reference and shrink nested `item` references.
  actor: object
  system: object
  inventory: object
  activeRules: string[]
  elementalBlasts: object | null
  uuid: string
  userId: string
}
export interface RequestCharacterDetailsArgs {
  action: 'requestCharacterDetails'
  userId: string
  actorId: string
  uuid: string
}
export interface AnybodyHomeArgs {
  action: 'anybodyHome'
  userId: string
}
export interface RollCheckArgs {
  action: 'rollCheck'
  userId: string
  characterId: string
  checkType: string
  checkSubtype: string
  modifiers: { label: string; modifier: number; enabled: boolean; ignored: boolean }[]
  options: object
  uuid: string
  targets?: string[]
  item?: ItemPF2e | null
  diceResults: DiceResults
}
export interface CharacterActionArgs {
  action: 'characterAction'
  userId: string
  characterId: string
  targets: string[]
  characterAction: string
  diceResults: DiceResults
  options: object
  uuid: string
}
export interface CastSpellArgs {
  action: 'castSpell'
  userId: string
  id: string
  characterId: string
  rank: number
  slotId: number
  uuid: string
  targets: string[]
}
export interface ConsumeItemArgs {
  action: 'consumeItem'
  userId: string
  characterId: string
  consumableId: string
  options: object
  uuid: string
}
export interface GetStrikeDamageArgs {
  action: 'getStrikeDamage'
  userId: string
  characterId: string
  actionSlug: string
  targets: string[]
  altUsage: number | undefined
  uuid: string
}
export interface ShareTargetsArgs {
  action: 'shareTargets'
  targets: Record<string, string[]>
  userId: string
}
export interface SendItemToChatArgs {
  action: 'sendItemToChat'
  userId: string
  characterId: string
  itemId: string
  uuid: string
}
export interface CallMacroArgs {
  action: 'callMacro'
  userId: string
  characterId: string
  targets: string[]
  compendiumName: string | null
  macroName: string | null
  macroUuid: string | null
  options: object
  uuid: string
}

export interface RequestResolutionArgs {
  action: 'acknowledged'
  uuid: string
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
