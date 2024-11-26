// TODO: (code quality) get rid of all the any's
import type { Socket } from 'socket.io-client'
export interface Actor {
  _id: string
  name: string
  feats: [FeatCategory]
  items: [Item]
  inventory: any
  system: System
  prototypeToken: any
  ownership: any
}

export interface User {
  _id: string
  getFlag: Function
  isGM: boolean
  active: boolean
  flags: { [key: string]: any }
  targets: any
}

export interface Game {
  socket: Socket
  user: User
  users: User[]
  scenes: any
}

export interface Action {
  damage: Function
  critical: Function
}
export interface Modifier {}

export interface Item {
  _id: string
  name: string
  type: string
  system: System
  img: string
  flags: any
  contents: any
}

export interface Scene {
  _id: string
  active: boolean
}
export interface Combat {
  _id: string
  active: boolean
  scene: Scene
}
export interface Combatant {
  actorId: string
}

export interface FeatCategory {
  label: string
  feats: [any]
}

// TODO: (refactor) this is piling together tons of System subtypes. Worth separating?
export interface System {
  skills: [Skill]
  build: { attributes: any }
  resources: any
  attributes: any
  abilities: any
  saves: any
  perception: any
  actions: any
  slug: string
  actionType: any
  traits: any
  location: any
  level: any
  prepared: any
  description: any
  time: any
  spelldc: any
  slots: any
  initiative: any
  equipped: any
  containerId: any
  details: any
  value: any
  quantity: any
  price: any
  spell: any
  uses: any
  proficiencies: any
  usage: any
  duration?: any
  target?: any
  save?: any
  area?: any
  range?: any
}

export interface Skill {
  lore: boolean
  label: string
  rank: number
  totalModifier: number
  modifiers: any[]
  slug: string
}

export interface Modifier {
  slug: string
  label: string
  modifier: number
  enabled: boolean
  hideIfDisabled: boolean
}

export interface World {
  userId: string
  release: any
  world: any
  system: any
  modules: any
  demoMode: boolean
  addresses: any
  files: any
  options: any
  activeUsers: string[]
  documentTypes: any
  template: any
  model: any
  paused: boolean
  users: any[]
  actors: any[]
  cards: any[]
  messages: any[]
  combats: any[]
  folders: any[]
  items: any[]
  journal: any[]
  macros: any[]
  playlists: any[]
  tables: any[]
  scenes: any[]
  packs: any[]
  settings: any[]
  coreUpdate: any
  systemUpdate: any
}

export interface StatModifier {
  enabled: boolean
  hideIfDisabled: boolean
}

export interface RollResult {}

export interface Action {
  type: string
  item: Item | undefined
  slug: string
}

export interface Trait {
  label: string
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

/// socket and internal types
export interface ResolutionArgs {}
export interface EventArgs {
  action: string
  uuid: string
  // request: EventRequest
  operation: EventOperation
  result: Item[] | string[]
  actorId: string
  characterId: string
  modifiers: any
  targets: string[]
  type: string
  userId: string
}
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

export interface EventRequest {
  _id: string
  type: string
  action: string
  parentUuid: string
}
export interface EventOperation {
  _id: string
  type: string
  action: string
  parentUuid: string
}
export interface EventResponse {
  result: EventRequest[]
}
