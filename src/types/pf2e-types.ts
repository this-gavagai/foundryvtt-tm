// TODO: (code quality) get rid of all the anys and refactor to represent subtypes, etc.
// TODO: is this available from foundry/pf2e?
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
  name?: string
  type?: string
  system?: System
  img?: string
  flags?: any
  contents?: any
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
