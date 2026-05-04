import type { Maybe } from './helpers'
import type { WeaponPF2e } from '@7h3laughingman/pf2e-types'
import type { Equipment, EquipmentSystem } from './equipment'
import { makeItem } from './item'

export interface WeaponSystem extends EquipmentSystem {
  runes: {
    potency: Maybe<number>
    striking: Maybe<number>
    property: Maybe<string[]>
  }
}

export interface Weapon extends Omit<Equipment, 'system'> {
  system: WeaponSystem
}

export function makeWeapon(root: WeaponPF2e): Weapon {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    label: undefined,
    system: {
      ...base.system,
      runes: {
        potency: root.system.runes?.potency,
        striking: root.system.runes?.striking,
        property: Array.from(root.system.runes?.property ?? [])
      }
    }
  } as Weapon
}
