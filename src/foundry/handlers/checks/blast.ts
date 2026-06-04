import type { ActorPF2e, DamageType, EffectTrait, Modifier } from '@7h3laughingman/pf2e-types'
import type { CheckRollHandler } from './types'
import { withRawModifierOverrides, type ModifierOverrideMap } from './modifierOverrides'

function getBlastModifiers(actor: ActorPF2e, element: string): Modifier[] {
  // ElementalBlast configs live on the actor's elementalBlasts flags. Each
  // config's statistic is a StatisticModifier — modifiers may be on the
  // prototype getter or the own `_modifiers` property after serialization.
  type BlastLike = { element?: string; statistic?: { modifiers?: Modifier[]; _modifiers?: Modifier[] } }
  const configs: BlastLike[] = (actor as unknown as { elementalBlasts?: { configs?: BlastLike[] } })
    ?.elementalBlasts?.configs ?? []
  const config = configs.find((c) => c.element === element)
  return config?.statistic?.modifiers ?? config?.statistic?._modifiers ?? []
}

export const handleBlast: CheckRollHandler = (ctx) => {
  const { actor, args, params } = ctx
  const [element, damageType, mapIncreases, isMelee] = args.checkSubtype.split(',')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  return withRawModifierOverrides(
    actor,
    (a) => getBlastModifiers(a, element),
    overrides,
    () => {
      const blasts = new game.pf2e.ElementalBlast(actor)
      return blasts.attack({
        ...params,
        element: element as EffectTrait,
        damageType: damageType as DamageType,
        mapIncreases: Number(mapIncreases),
        melee: isMelee === 'true'
      }) as Promise<unknown>
    }
  )
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
