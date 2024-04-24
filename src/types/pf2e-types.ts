// TODO: (code quality) get rid of all the any's

export interface Actor {
  _id: string
  name: string
  feats: [FeatCategory]
  items: [Item]
  inventory: any
  system: System
  prototypeToken: any
  requestCharacterDetails: any
}

export interface Item {
  _id: string
  name: string
  type: string
  system: System
  img: string
  flags: any
  contents: any
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
}

export interface Skill {
  lore: boolean
  label: string
  rank: number
  totalModifier: number
  modifiers: [any]
  slug: string
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
  }
}
