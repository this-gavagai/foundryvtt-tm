import type { EquipmentPF2e } from '@7h3laughingman/pf2e-types'
import type { PhysicalItem, PhysicalItemSystem } from './physicalItem'
import { makePhysicalItem } from './physicalItem'

export interface Equipment extends PhysicalItem {
  system: PhysicalItemSystem
}

export function makeEquipment(root: EquipmentPF2e): Equipment {
  const base = makePhysicalItem(root)
  return {
    ...base,
    system: { ...base.system }
  } as Equipment
}
