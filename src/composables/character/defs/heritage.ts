import type { HeritagePF2e } from '@7h3laughingman/pf2e-types'
import type { Item } from './item'
import { makeItem } from './item'

export type Heritage = Item

export function makeHeritage(root: HeritagePF2e | undefined): Heritage | undefined {
  return makeItem(root) as Heritage | undefined
}
