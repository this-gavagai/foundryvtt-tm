import type { Maybe } from './helpers'
import type { ArmorPF2e } from '@7h3laughingman/pf2e-types'
import type { Equipment, EquipmentSystem } from './equipment'
import { makeItem } from './item'

export interface ArmorSystem extends EquipmentSystem {
  runes: {
    potency: Maybe<number>
    resilient: Maybe<number>
    property: Maybe<string[]>
  }
}

export interface Armor extends Omit<Equipment, 'system'> {
  system: ArmorSystem
}

export function makeArmor(root: ArmorPF2e): Armor {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    label: undefined,
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
