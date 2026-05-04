import type { ClassPF2e } from '@7h3laughingman/pf2e-types'
import type { Item } from './item'
import { makeItem } from './item'

export type ClassType = Item

export function makeClassType(root: ClassPF2e | undefined): ClassType | undefined {
  return makeItem(root) as ClassType | undefined
}
