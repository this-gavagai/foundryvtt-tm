export interface Actor {
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
  skills: [any]
  build: { attributes: any }
}
