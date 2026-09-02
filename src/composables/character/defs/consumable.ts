import type { Maybe } from '@/composables/character/helpers'
import type { ConsumablePF2e } from '@7h3laughingman/pf2e-types'
import type { PhysicalItem, PhysicalItemSystem } from './physicalItem'
import { makePhysicalItem } from './physicalItem'
import type { RequestResolutionArgs } from '@/types/api-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

export interface ConsumableSystem extends PhysicalItemSystem {
  uses: { value: Maybe<number>; max: Maybe<number> }
  // potion / scroll / wand / talisman / … — the inventory row needs it to
  // follow PF2e's own rule for when charges are worth showing.
  category: Maybe<string>
  spell: {
    system: {
      level: { value: Maybe<number> }
      description: { value: Maybe<string> }
    }
  }
}

export interface Consumable extends PhysicalItem {
  system: ConsumableSystem
  consumeItem?: () => Promise<RequestResolutionArgs>
  changeUses?: (newTotal: number) => Promise<DocumentSocketResponse | null>
}

export function makeConsumable(root: ConsumablePF2e): Consumable {
  const base = makePhysicalItem(root)
  return {
    ...base,
    system: {
      ...base.system,
      uses: { value: root.system.uses?.value, max: root.system.uses?.max },
      category: root.system.category,
      spell: {
        system: {
          level: { value: root.system.spell?.system?.level?.value },
          description: { value: root.system.spell?.system?.description?.value }
        }
      }
    }
  } as Consumable
}
