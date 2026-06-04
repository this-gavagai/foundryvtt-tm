import { logger } from '@/utils/utilities'
import type { ActorPF2e, Modifier } from '@7h3laughingman/pf2e-types'
import type { StrikeActionRuntime } from '@/foundry/utils/strike'
import type { CheckRollHandler } from './types'
import { withRawModifierOverrides, type ModifierOverrideMap } from './modifierOverrides'

function getStrikeModifiers(
  actor: ActorPF2e,
  actionSlug: string,
  altUsage: string
): Modifier[] {
  const base = actor.system.actions.find((a) => a.slug === actionSlug) as
    | StrikeActionRuntime
    | undefined
  const target = altUsage?.length ? base?.altUsages?.[Number(altUsage)] : base
  // StatisticModifier exposes modifiers via a prototype getter; after JSON
  // serialization only the own property `_modifiers` survives. Accept both.
  const raw = target as unknown as { modifiers?: Modifier[]; _modifiers?: Modifier[] } | undefined
  return raw?.modifiers ?? raw?._modifiers ?? []
}

export const handleStrike: CheckRollHandler = (ctx) => {
  const { actor, args, params } = ctx
  const [actionSlug, variant, altUsage] = args.checkSubtype.split(',')
  logger.debug("here's some stuff", args.checkSubtype, altUsage, altUsage?.length)
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  return withRawModifierOverrides(
    actor,
    (a) => getStrikeModifiers(a, actionSlug, altUsage),
    overrides,
    () => {
      const base = actor.system.actions.find((a) => a.slug === actionSlug) as
        | StrikeActionRuntime
        | undefined
      const strikeTarget = altUsage?.length ? base?.altUsages?.[Number(altUsage)] : base
      return Promise.resolve(strikeTarget?.variants[Number(variant)]?.roll(params))
    }
  )
}

export const handleStrikeDamage: CheckRollHandler = ({ actor, args, params }) => {
  logger.debug('TM-params', params)
  const [damageSlug, damageDegree, damageAltUsage] = args.checkSubtype.split(',')
  const baseDmgStrike = actor.system.actions.find((a) => a.slug === damageSlug) as
    | StrikeActionRuntime
    | undefined
  const dmgTarget = damageAltUsage?.length
    ? baseDmgStrike?.altUsages?.[Number(damageAltUsage)]
    : baseDmgStrike
  return damageDegree === 'critical' ? dmgTarget?.critical(params) : dmgTarget?.damage(params)
}
