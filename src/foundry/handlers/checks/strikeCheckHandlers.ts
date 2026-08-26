import { logger } from '@/utils/utilities'
import type { ActorPF2e, Modifier } from '@7h3laughingman/pf2e-types'
import { findStrikeAction, type StrikeRef } from '@/foundry/utils/strikeRuntime'
import type { CheckRollHandler } from './types'
import { checkSubtypeOf } from './subtype'
import {
  withDamageModifierOverrides,
  withRawModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

function getStrikeModifiers(actor: ActorPF2e, ref: StrikeRef): Modifier[] {
  // StatisticModifier exposes modifiers via a prototype getter; after JSON
  // serialization only the own property `_modifiers` survives. Accept both.
  const raw = findStrikeAction(actor, ref) as
    | { modifiers?: Modifier[]; _modifiers?: Modifier[] }
    | undefined
  return raw?.modifiers ?? raw?._modifiers ?? []
}

export const handleStrike: CheckRollHandler = (ctx) => {
  const { actor, args, params } = ctx
  const { actionSlug, variant, altUsage, itemId, usage } = checkSubtypeOf(args, 'strike')
  const ref: StrikeRef = { actionSlug, altUsage, itemId, usage }
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  return withRawModifierOverrides(
    actor,
    (a) => getStrikeModifiers(a, ref),
    overrides,
    () => Promise.resolve(findStrikeAction(actor, ref)?.variants[variant]?.roll(params))
  )
}

export const handleStrikeDamage: CheckRollHandler = ({ actor, args, params }) => {
  logger.debug('TM-params', params)
  const { actionSlug, degree, altUsage, itemId, usage } = checkSubtypeOf(args, 'damage')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const dmgTarget = findStrikeAction(actor, { actionSlug, altUsage, itemId, usage })
  return withDamageModifierOverrides(
    overrides,
    async () =>
      (await (degree === 'critical' ? dmgTarget?.critical(params) : dmgTarget?.damage(params))) ??
      null
  )
}
