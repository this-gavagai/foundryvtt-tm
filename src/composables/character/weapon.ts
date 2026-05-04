import type { Maybe } from './helpers'
import type { WeaponPF2e } from '@7h3laughingman/pf2e-types'
import type { PhysicalItem, PhysicalItemSystem } from './physicalItem'
import { makePhysicalItem } from './physicalItem'

export interface WeaponSystem extends PhysicalItemSystem {
  traits: {
    rarity: Maybe<string>
    value: Maybe<string[]>
    toggles: { modular: { selected: Maybe<string> }; versatile: { selected: Maybe<string> } }
  }
  damage: { damageType: Maybe<string> }
  range: Maybe<number>
  runes: {
    potency: Maybe<number>
    striking: Maybe<number>
    property: Maybe<string[]>
  }
}

export interface Weapon extends PhysicalItem {
  system: WeaponSystem
}

export function makeWeapon(root: WeaponPF2e): Weapon {
  const base = makePhysicalItem(root)
  return {
    ...base,
    system: {
      ...base.system,
      traits: {
        ...base.system.traits,
        toggles: {
          modular: { selected: root.system.traits?.toggles?.modular?.selected },
          versatile: { selected: root.system.traits?.toggles?.versatile?.selected }
        }
      },
      damage: { damageType: root.system.damage?.damageType },
      range: root.system.range ?? undefined,
      runes: {
        potency: root.system.runes?.potency,
        striking: root.system.runes?.striking,
        property: Array.from(root.system.runes?.property ?? [])
      }
    }
  } as Weapon
}
