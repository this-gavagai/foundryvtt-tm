export interface Actor {
  _id: String
  feats: [FeatCategory]
  items: [Item]
  system: System
}

export interface Item {
  _id: string
  name: string
  type: string
  system: any
  img: string
}

export interface FeatCategory {
  label: string
  feats: [any]
}

export interface System {
  skills: [Skill]
  build: { attributes: any }
}

export interface Skill {
  lore: boolean
  label: string
  rank: number
  totalModifier: number
}
