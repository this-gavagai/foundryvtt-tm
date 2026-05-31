import type { DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { CheckRollHandler } from './types'

export const handleBlast: CheckRollHandler = ({ actor, args, params }) => {
  const [element, damageType, mapIncreases, isMelee] = args.checkSubtype.split(',')
  const blasts = new game.pf2e.ElementalBlast(actor)
  return blasts.attack({
    ...params,
    element: element as EffectTrait,
    damageType: damageType as DamageType,
    mapIncreases: Number(mapIncreases),
    melee: isMelee === 'true'
  })
}

export const handleBlastDamage: CheckRollHandler = ({ actor, args, params }) => {
  const [element, damageType, outcome, isMelee] = args.checkSubtype.split(',')
  const damageBlasts = new game.pf2e.ElementalBlast(actor)
  return damageBlasts.damage({
    ...params,
    element: element as EffectTrait,
    damageType: damageType as DamageType,
    outcome: outcome as 'success' | 'criticalSuccess',
    melee: isMelee === 'true'
  })
}
