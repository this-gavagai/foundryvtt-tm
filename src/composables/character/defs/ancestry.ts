import type { AncestryPF2e } from '@7h3laughingman/pf2e-types'
import type { Item } from './item'
import { makeItem } from './item'

export type Ancestry = Item

export function makeAncestry(root: AncestryPF2e | undefined): Ancestry | undefined {
  return makeItem(root) as Ancestry | undefined
}
