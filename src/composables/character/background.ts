import type { BackgroundPF2e } from '@7h3laughingman/pf2e-types'
import type { Item } from './item'
import { makeItem } from './item'

export type Background = Item

export function makeBackground(root: BackgroundPF2e | undefined): Background | undefined {
  return makeItem(root) as Background | undefined
}
