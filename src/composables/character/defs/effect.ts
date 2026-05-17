import type { AbstractEffectPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'

export interface Effect extends Item {
  system: EffectSystem
}

export type EffectSystem = ItemSystem

export function makeEffect(root: AbstractEffectPF2e): Effect {
  const base = makeItem(root)!
  return {
    ...base,
    system: {
      ...base.system
    }
  } as Effect
}
