export interface Actor {
  _id: string
  name: string
  feats: [FeatCategory]
  items: [Item]
  inventory: any
  system: System
  prototypeToken: any
}

export interface Item {
  _id: string
  name: string
  type: string
  system: System
  img: string
  flags: any
}

export interface FeatCategory {
  label: string
  feats: [any]
}

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
}

export interface Skill {
  lore: boolean
  label: string
  rank: number
  totalModifier: number
  modifiers: [any]
  slug: string
}

// debugging conveniences
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altCharacters: any
    link: any
  }
}
