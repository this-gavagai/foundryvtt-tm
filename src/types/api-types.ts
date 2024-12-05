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
}
export interface RequestCharacterDetailsArgs {
  action: 'requestCharacterDetails'
  actorId: string
}
export interface AnybodyHomeArgs {
  action: 'anybodyHome'
}
export interface RollCheckArgs {
  action: 'rollCheck'
  characterId: string
  checkType: string
  checkSubtype: string
  modifiers: any
  options: any
  skipDialog: boolean
  uuid: string
  targets?: any
}
export interface CharacterActionArgs {
  action: 'characterAction'
  characterId: string
  targets: any
  characterAction: any
  options: any
  uuid: string
}
export interface CastSpellArgs {
  action: 'castSpell'
  id: string
  characterId: string
  rank: number
  slotId: number
  uuid: string
  targets: string[]
}
export interface ConsumeItemArgs {
  action: 'consumeItem'
  characterId: string
  consumableId: string
  options: any
  uuid: string
}

// TODO (types): what the heck is this resolutionargs thing composed of?
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
  }
}
