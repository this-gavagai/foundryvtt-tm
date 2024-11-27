export type ModuleEventArgs =
  | AcknowledgementArgs
  | ListenderOnlineArgs
  | UpdateCharacterDetailsArgs
  | RequestCharacterDetailsArgs

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
  feats: string
  system: string
}
export interface RequestCharacterDetailsArgs {
  action: 'requestCharacterDetails'
  actorId: string
}

export interface ResolutionArgs {}
export interface CheckArgs {
  action: string
  characterId: string
  checkType: string
  checkSubtype: string
  modifiers: any
  options: any
  skipDialog: boolean
  uuid: string
  targets?: any
}
export interface ActionArgs {
  action: string
  characterId: string
  targets: any
  characterAction: any
  options: any
  uuid: string
}
export interface CastArgs {
  action: string
  id: string
  characterId: string
  rank: number
  slotId: number
  uuid: string
}
export interface ConsumeArgs {
  action: string
  characterId: string
  consumableId: string
  options: any
  uuid: string
}

// debugging conveniences
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altCharacters: any
    link: any
    game: any
    Hooks: any
    character: any
  }
}
