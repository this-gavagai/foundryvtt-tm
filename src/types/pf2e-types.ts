// TODO (types): find an official source for all this. This is a terrible cludge here.

export interface Actor {
  _id: string
  name: string
  feats: [FeatCategory]
  items: [Item]
  inventory: any
  system: System
  prototypeToken: any
  ownership: any
  elementalBlasts: ElementalBlasts
}

export interface ElementalBlasts {
  configs: any[]
  item: Item
}
export interface ElementalBlastConfig {
  actionCost: number
  damageTypes: { value: string; label: string }[]
  element: string
  img: string
  item: Item
  range: { increment: number; max: number; label: string }
  maps: {
    melee: { map0: string; map1: string; map2: string }
    ranged: { map0: string; map1: string; map2: string }
  }
  statistic: Stat
}

export interface Item {
  _id: string
  name?: string
  type?: string
  category?: string
  system: System
  img?: string
  flags?: any
  contents?: string
}
export interface IWR {
  type: string
  exceptions: string[]
  definition: string
  value?: number
}
export interface Stat {
  label: string
  slug: string
  type: string
  breakdown: string
  attribute: string
  rank: number
  modifiers: Modifier[]
  total: number
  value: number
  totalModifier: number
  dc: number
  armor: boolean
  lore: boolean
}
export interface Perception {}

export interface Movement {
  label: string
  slug: string
  type: string
  total: number
  value: number
  totalModifier: number
  _modifiers: Modifier[]
}

export interface Action {
  _id: string
  label: string
  damage: Function
  altUsages: Action[]
  critical: Function
  variants: { label: string }[]
  traits: { name: string; label: string; description: string }[]
  weaponTraits: { name: string; label: string; description: string }[]
  tmDamageFormula: { base: string; critical: string; _modifiers: Modifier[] }
  _modifiers: Modifier[]
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
  id: string
  label: string
  feats: [any]
}

export interface System {
  skills: [Stat]
  build: { attributes: any }
  resources: any
  attributes: any
  abilities: any
  saves: any
  bulk: any
  stackGroup: string
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
  slots: {
    [key: string]: {
      value: number
      max: number
      prepared: { id: string | null; expended: boolean }[]
    }
  }
  hp: { value: number }
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
  damage: { damageType: string }
  category?: any
  rules: Rule[]
}
export interface Rule {
  option: string
  selection: string
  key: string
  toggleable: boolean
  label: string
  suboptions: { label: string; value: string }[]
  value: boolean | undefined
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
  diceNumber: number
  dieSize: string
  damageType: string
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
