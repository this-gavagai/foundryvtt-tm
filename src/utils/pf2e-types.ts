export interface Item {
  name: string
  type: string
  system: any
  img: string
}

export interface FeatCategory {
  label: string
  feats: [any]
}

export interface Actor {
  feats: [FeatCategory]
  items: [any]
}
