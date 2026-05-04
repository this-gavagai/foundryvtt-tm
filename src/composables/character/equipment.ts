import type { Maybe } from './helpers'
import type { EquipmentPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

export interface Equipment extends Omit<Item, 'system'> {
  system: EquipmentSystem
  label: Maybe<string>
  toggleInvested?: (newValue?: Maybe<boolean>) => Promise<DocumentSocketResponse | null>
  changeCarry?: (
    method: Maybe<string>,
    hands: Maybe<number>,
    container: Maybe<string | null>,
    inSlot?: Maybe<boolean>
  ) => Promise<DocumentSocketResponse | null>
}

export interface EquipmentSystem extends ItemSystem {}

export function makeEquipment(root: EquipmentPF2e): Equipment {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    label: undefined,
    system: {
      ...base.system
    }
  } as Equipment
}
