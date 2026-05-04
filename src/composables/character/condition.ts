import type { Maybe } from './helpers'
import type { ConditionPF2e } from '@7h3laughingman/pf2e-types'
import type { Effect, EffectSystem } from './effect'
import { makeEffect } from './effect'

export interface ConditionSystem extends EffectSystem {
  value: { value: Maybe<number>; isValued: Maybe<boolean> }
}

export interface Condition extends Effect {
  system: ConditionSystem
}

export function makeCondition(root: ConditionPF2e): Condition {
  const base = makeEffect(root as unknown as Parameters<typeof makeEffect>[0])
  return {
    ...base,
    system: {
      ...base.system,
      value: { value: root.system.value?.value ?? undefined, isValued: root.system.value?.isValued }
    }
  } as Condition
}
