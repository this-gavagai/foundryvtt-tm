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
  | ShareTargetArgs
  | SendItemToChatArgs
  | CallMacroArgs

export interface AcknowledgementArgs {
  action: 'acknowledged'
  uuid: string
}
export interface ListenderOnlineArgs {
  action: 'listenerOnline'
}
export interface UpdateCharacterDetailsArgs {
  action: 'updateCharacterDetails'
  actorId: string
  actor: string
  // feats: string
  system: string
  inventory: string
  elementalBlasts: string
  uuid: string
}
export interface RequestCharacterDetailsArgs {
  action: 'requestCharacterDetails'
  userId: string
  actorId: string
  uuid: string
}
export interface AnybodyHomeArgs {
  action: 'anybodyHome'
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
  diceResults: DiceResults
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
export interface ShareTargetArgs {
  action: 'shareTarget'
  userId: string
  targets: string[]
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
  compendiumName: string
  macroName: string
  options: object
  uuid: string
}

export interface ResolutionArgs {}

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
