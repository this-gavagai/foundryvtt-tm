import type { EffectPF2e } from '@7h3laughingman/pf2e-types'
import type { Item, ItemSystem } from './item'
import { makeItem } from './item'

export interface Effect extends Omit<Item, 'system'> {
  system: EffectSystem
}

export interface EffectSystem extends ItemSystem {}

export function makeEffect(root: EffectPF2e): Effect {
  const base = makeItem(root as unknown as Parameters<typeof makeItem>[0])!
  return {
    ...base,
    system: {
      ...base.system
    }
  } as Effect
}
