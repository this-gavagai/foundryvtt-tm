import type { DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { CheckRollHandler } from './types'
import { checkSubtypeOf } from './subtype'
import {
  withBlastModifierOverrides,
  withDamageModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

export const handleBlast: CheckRollHandler = (ctx) => {
  const { actor, args, params } = ctx
  const { element, damageType, variant, isMelee } = checkSubtypeOf(args, 'blast')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  // Blasts roll off an ephemeral statistic that ElementalBlast.attack() derives
  // from the actor's "impulse" statistic via `extend()`; withBlastModifierOverrides
  // shadows that extend to apply the overrides. See modifierOverrides.ts.
  return withBlastModifierOverrides(actor.getStatistic('impulse'), overrides, () => {
    const blasts = new game.pf2e.ElementalBlast(actor)
    return blasts.attack({
      ...params,
      element: element as EffectTrait,
      damageType: damageType as DamageType,
      mapIncreases: variant,
      melee: isMelee
    }) as Promise<unknown>
  })
}

export const handleBlastDamage: CheckRollHandler = ({ actor, args, params }) => {
  const { element, damageType, outcome, isMelee } = checkSubtypeOf(args, 'blastDamage')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const damageBlasts = new game.pf2e.ElementalBlast(actor)
  return withDamageModifierOverrides(overrides, () =>
    damageBlasts.damage({
      ...params,
      element: element as EffectTrait,
      damageType: damageType as DamageType,
      outcome,
      melee: isMelee
    })
  )
}
