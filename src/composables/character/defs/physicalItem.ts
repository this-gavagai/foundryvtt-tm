import type { Maybe } from '@/composables/character/helpers'
import type { PhysicalItemPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

export interface PhysicalItemSystem extends ItemSystem {
  bulk: { value: Maybe<number> }
  stackGroup: Maybe<string>
  identification: {
    status: Maybe<string>
    unidentified: { name: Maybe<string>; data: { description: { value: Maybe<string> } } }
  }
  equipped: {
    carryType: Maybe<string>
    invested: Maybe<boolean>
    handsHeld: Maybe<number>
    inSlot: Maybe<boolean>
  }
  usage: { value: Maybe<string> }
  hp: { value: Maybe<number> }
  containerId: Maybe<string>
  quantity: Maybe<number>
  price: {
    value: { gp: Maybe<number>; sp: Maybe<number>; cp: Maybe<number> }
    per: Maybe<number>
  }
  subitems: Maybe<Item[]>
}

export interface PhysicalItem extends Item {
  system: PhysicalItemSystem
  label: Maybe<string>
  toggleInvested?: (newValue?: Maybe<boolean>) => Promise<DocumentSocketResponse | null>
  changeCarry?: (
    method: Maybe<string>,
    hands: Maybe<number>,
    container: Maybe<string | null>,
    inSlot?: Maybe<boolean>
  ) => Promise<DocumentSocketResponse | null>
}

export function makePhysicalItem(root: PhysicalItemPF2e): PhysicalItem {
  const base = makeItem(root)!
  const identification = root.system.identification
  // When an item is unidentified, the player should only see the generic
  // "unidentified" description — the real description.value still carries the
  // item's true nature, so swap it out at the data layer.
  const isUnidentified = identification?.status === 'unidentified'
  return {
    ...base,
    label: undefined,
    system: {
      ...base.system,
      description: {
        value: isUnidentified
          ? identification?.unidentified?.data?.description?.value ?? ''
          : base.system.description.value
      },
      identification: {
        status: identification?.status,
        unidentified: {
          name: identification?.unidentified?.name,
          data: {
            description: { value: identification?.unidentified?.data?.description?.value }
          }
        }
      },
      bulk: { value: root.system.bulk?.value },
      stackGroup: root.system.stackGroup,
      equipped: {
        carryType: root.system.equipped?.carryType,
        invested: root.system.equipped?.invested ?? undefined,
        handsHeld: root.system.equipped?.handsHeld,
        inSlot: root.system.equipped?.inSlot
      },
      usage: { value: root.system.usage?.value },
      hp: { value: root.system.hp?.value },
      containerId: root.system.containerId ?? undefined,
      quantity: root.system.quantity,
      price: {
        value: {
          gp: root.system.price?.value?.gp,
          sp: root.system.price?.value?.sp,
          cp: root.system.price?.value?.cp
        },
        per: root.system.price?.per
      },
      // The wire payload serializes items via toObject(), so attached items
      // (shield bosses, etc.) arrive as source data under system.subitems —
      // the live `subitems` Collection only exists on a prepared document.
      // Prefer the source array, falling back to the Collection just in case.
      subitems: (root.subitems?.contents ?? root.system.subitems)?.map((i) =>
        makePhysicalItem(i as unknown as Parameters<typeof makePhysicalItem>[0])
      )
    }
  } as PhysicalItem
}
