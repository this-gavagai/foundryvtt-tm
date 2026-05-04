import type { Maybe } from './helpers'
import type { FeatPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'

export interface Feat extends Omit<Item, 'system'> {
  system: FeatSystem
}

export interface FeatSystem extends ItemSystem {
  location: { value: Maybe<string> }
}

export function makeFeat(root: FeatPF2e): Feat {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    system: {
      ...base.system,
      location: { value: root.system.location ?? undefined }
    }
  } as Feat
}
