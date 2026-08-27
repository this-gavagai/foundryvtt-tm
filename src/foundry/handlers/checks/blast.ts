import type { ActorPF2e, CharacterPF2e, DamageType, EffectTrait } from '@7h3laughingman/pf2e-types'
import type { CheckRollHandler } from './types'
import { checkSubtypeOf } from './subtype'
import {
  withBlastModifierOverrides,
  withDamageModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

// PF2e's ElementalBlast is built from a CharacterPF2e — impulses are a
// kineticist class feature, and no other actor type has one. A request naming
// some other actor is the app's state having drifted from the world's, so throw
// and let the dispatch answer with an error ack.
function blastCharacter(actor: ActorPF2e): CharacterPF2e {
  if (!actor.isOfType('character')) {
    throw new Error(`${actor.name} is not a character and has no elemental blast`)
  }
  return actor
}

export const handleBlast: CheckRollHandler = (ctx) => {
  const { source, args, params } = ctx
  const actor = blastCharacter(ctx.actor)
  const { element, damageType, variant, isMelee } = checkSubtypeOf(args, 'blast')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  // Blasts roll off an ephemeral statistic that ElementalBlast.attack() derives
  // from the actor's "impulse" statistic via `extend()`; withBlastModifierOverrides
  // shadows that extend to apply the overrides. See modifierOverrides.ts.
  return withBlastModifierOverrides(actor.getStatistic('impulse'), overrides, () => {
    const blasts = new source.pf2e.ElementalBlast(actor)
    return blasts.attack({
      ...params,
      element: element as EffectTrait,
      damageType: damageType as DamageType,
      mapIncreases: variant,
      melee: isMelee
    }) as Promise<unknown>
  })
}

export const handleBlastDamage: CheckRollHandler = ({ source, actor: rawActor, args, params }) => {
  const actor = blastCharacter(rawActor)
  const { element, damageType, outcome, isMelee } = checkSubtypeOf(args, 'blastDamage')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const damageBlasts = new source.pf2e.ElementalBlast(actor)
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
