import type { DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { CheckRollHandler } from './types'
import {
  withBlastModifierOverrides,
  withDamageModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

export const handleBlast: CheckRollHandler = (ctx) => {
  const { actor, args, params } = ctx
  const [element, damageType, mapIncreases, isMelee] = args.checkSubtype.split(',')
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
      mapIncreases: Number(mapIncreases),
      melee: isMelee === 'true'
    }) as Promise<unknown>
  })
}

export const handleBlastDamage: CheckRollHandler = ({ actor, args, params }) => {
  const [element, damageType, outcome, isMelee] = args.checkSubtype.split(',')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const damageBlasts = new game.pf2e.ElementalBlast(actor)
  return withDamageModifierOverrides(overrides, () =>
    damageBlasts.damage({
      ...params,
      element: element as EffectTrait,
      damageType: damageType as DamageType,
      outcome: outcome as 'success' | 'criticalSuccess',
      melee: isMelee === 'true'
    })
  )
}
