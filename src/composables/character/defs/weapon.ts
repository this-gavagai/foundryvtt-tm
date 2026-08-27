import { isItemOfType, type Maybe } from '@/composables/character/helpers'
import type { MeleePF2e, WeaponPF2e } from '@7h3laughingman/pf2e-types'
import { makeItem } from './item'
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

// The item behind a strike, projected onto the Weapon view shape.
//
// It is not always a weapon. PF2e builds an NPC's strikes from its `melee` items
// rather than from carried equipment, so that is what an NPC strike hands over —
// and a melee item is not a physical item at all: no bulk, quantity, price or
// subitems, and none of the weapon-only fields below. What the NPC strike list
// reads off it is its identity (id, name, art, traits), which is makeItem's half.
//
// The weapon-only fields therefore come off a narrowed `weapon` and are undefined
// for a melee item — the same values the sheet has always shown, but now because
// the type says they may be absent rather than because a WeaponPF2e assertion
// hid that they are.
export function makeWeapon(root: WeaponPF2e | MeleePF2e): Weapon {
  const weapon = isItemOfType(root, 'weapon') ? root : undefined
  const base = weapon ? makePhysicalItem(weapon) : makeItem(root)!
  return {
    ...base,
    system: {
      ...base.system,
      traits: {
        ...base.system.traits,
        toggles: {
          modular: { selected: weapon?.system.traits?.toggles?.modular?.selected },
          versatile: { selected: weapon?.system.traits?.toggles?.versatile?.selected }
        }
      },
      damage: { damageType: weapon?.system.damage?.damageType },
      range: weapon?.system.range ?? undefined,
      runes: {
        potency: weapon?.system.runes?.potency,
        striking: weapon?.system.runes?.striking,
        property: Array.from(weapon?.system.runes?.property ?? [])
      }
    }
  } as Weapon
}
