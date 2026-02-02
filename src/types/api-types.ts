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
  actor: string
  system: string
  inventory: string
  activeRules: string
  elementalBlasts: string
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
  modifiers: any
  options: any
  uuid: string
  targets?: string[]
  item?: Item | null
  diceResults: DiceResults
}
export interface CharacterActionArgs {
  action: 'characterAction'
  userId: string
  characterId: string
  targets: any
  characterAction: any
  diceResults: DiceResults
  options: any
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
    modifiers?: any
  }
}

export interface ActiveRoll {
  action: 'action' | 'check'
  slug?: string
  label?: string
  paramsString?: string
  params?: Record<string, string>
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
  }
}
