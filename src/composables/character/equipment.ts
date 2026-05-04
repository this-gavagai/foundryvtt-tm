import type { EquipmentPF2e } from '@7h3laughingman/pf2e-types'
import type { PhysicalItem, PhysicalItemSystem } from './physicalItem'
import { makePhysicalItem } from './physicalItem'

export interface EquipmentSystem extends PhysicalItemSystem {}

export interface Equipment extends Omit<PhysicalItem, 'system'> {
  system: EquipmentSystem
}

export function makeEquipment(root: EquipmentPF2e): Equipment {
  const base = makePhysicalItem(root)
  return {
    ...base,
    system: { ...base.system }
  } as Equipment
}
