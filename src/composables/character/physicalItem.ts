import type { Maybe } from './helpers'
import type { PhysicalItemPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

export interface PhysicalItemSystem extends ItemSystem {
  bulk: { value: Maybe<number> }
  stackGroup: Maybe<string>
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
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    label: undefined,
    system: {
      ...base.system,
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
      subitems: root.system.subitems?.map((i) => makeItem(i as unknown as Parameters<typeof makeItem>[0]))
    }
  } as PhysicalItem
}
