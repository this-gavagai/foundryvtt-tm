import type { Maybe } from './helpers'
import type { ArmorPF2e } from '@7h3laughingman/pf2e-types'
import type { PhysicalItem, PhysicalItemSystem } from './physicalItem'
import { makePhysicalItem } from './physicalItem'

export interface ArmorSystem extends PhysicalItemSystem {
  runes: {
    potency: Maybe<number>
    resilient: Maybe<number>
    property: Maybe<string[]>
  }
}

export interface Armor extends Omit<PhysicalItem, 'system'> {
  system: ArmorSystem
}

export function makeArmor(root: ArmorPF2e): Armor {
  const base = makePhysicalItem(root)
  return {
    ...base,
    system: {
      ...base.system,
      runes: {
        potency: root.system.runes?.potency,
        resilient: root.system.runes?.resilient,
        property: Array.from(root.system.runes?.property ?? [])
      }
    }
  } as Armor
}
