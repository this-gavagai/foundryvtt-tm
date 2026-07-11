import { logger } from '@/utils/utilities'
import type { ActorPF2e, Modifier } from '@7h3laughingman/pf2e-types'
import type { StrikeActionRuntime } from '@/foundry/utils/strikeRuntime'
import type { CheckRollHandler } from './types'
import { checkSubtypeOf } from './subtype'
import {
  withDamageModifierOverrides,
  withRawModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

function getStrikeModifiers(
  actor: ActorPF2e,
  actionSlug: string,
  altUsage: number | undefined
): Modifier[] {
  const base = actor.system.actions?.find((a) => a.slug === actionSlug) as
    | StrikeActionRuntime
    | undefined
  const target = altUsage !== undefined ? base?.altUsages?.[altUsage] : base
  // StatisticModifier exposes modifiers via a prototype getter; after JSON
  // serialization only the own property `_modifiers` survives. Accept both.
  const raw = target as
    | (StrikeActionRuntime & { modifiers?: Modifier[]; _modifiers?: Modifier[] })
    | undefined
  return raw?.modifiers ?? raw?._modifiers ?? []
}

export const handleStrike: CheckRollHandler = (ctx) => {
  const { actor, args, params } = ctx
  const { actionSlug, variant, altUsage } = checkSubtypeOf(args, 'strike')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  return withRawModifierOverrides(
    actor,
    (a) => getStrikeModifiers(a, actionSlug, altUsage),
    overrides,
    () => {
      const base = actor.system.actions.find((a) => a.slug === actionSlug) as
        | StrikeActionRuntime
        | undefined
      const strikeTarget = altUsage !== undefined ? base?.altUsages?.[altUsage] : base
      return Promise.resolve(strikeTarget?.variants[variant]?.roll(params))
    }
  )
}

export const handleStrikeDamage: CheckRollHandler = ({ actor, args, params }) => {
  logger.debug('TM-params', params)
  const { actionSlug, degree, altUsage } = checkSubtypeOf(args, 'damage')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const baseDmgStrike = actor.system.actions.find((a) => a.slug === actionSlug) as
    | StrikeActionRuntime
    | undefined
  const dmgTarget = altUsage !== undefined ? baseDmgStrike?.altUsages?.[altUsage] : baseDmgStrike
  return withDamageModifierOverrides(
    overrides,
    async () =>
      (await (degree === 'critical' ? dmgTarget?.critical(params) : dmgTarget?.damage(params))) ??
      null
  )
}
