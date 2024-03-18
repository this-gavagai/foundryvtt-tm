interface ActorBase {
  _id: string
  feats: [FeatCategory]
  items: [Item]
  inventory: any
  system: System
}
interface ActorBaseReactive {
  value: ActorBase
}
export interface Actor extends ActorBase, ActorBaseReactive {}

// export interface ActorReactive {
//   value: Actor
// }

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
}

export interface Skill {
  lore: boolean
  label: string
  rank: number
  totalModifier: number
  modifiers: [any]
  slug: string
}
