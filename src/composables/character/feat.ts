import type { Maybe } from './helpers'
import type { FeatPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'

export interface Feat extends Omit<Item, 'system'> {
  system: FeatSystem
}

export interface FeatSystem extends ItemSystem {
  category: Maybe<string>
  location: { value: Maybe<string> }
  level: { value: Maybe<number>; taken: Maybe<number> }
  actions: { value: Maybe<string> }
}

export function makeFeat(root: FeatPF2e): Feat {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    system: {
      ...base.system,
      category: root.system.category ?? undefined,
      location: { value: root.system.location ?? undefined },
      level: { value: root.system.level?.value, taken: root.system.level?.taken ?? undefined },
      actions: { value: root.system.actions?.value ?? undefined }
    }
  } as Feat
}
