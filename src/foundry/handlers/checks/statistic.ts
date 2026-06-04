import type { ActorPF2e, SaveType, Statistic } from '@7h3laughingman/pf2e-types'
import { type CheckRollHandler, statisticParams } from './types'
import { withModifierOverrides, type ModifierOverrideMap } from './modifierOverrides'

// PF2e's Statistic API (save/skill/perception/initiative) expects
// params.target to be an ActorPF2e — it calls target.getActiveTokens() on it
// to drive DC/display. statisticParams swaps in the actor proxy that exposes
// getActiveTokens on behalf of the player's chosen target.

// Per-roll modifier toggles arrive on options.modifierOverrides as a
// { slug: enabled } map (see StatBox.vue, which lets users tap modifiers in
// the info modal to flip them green/red). withModifierOverrides handles
// both the no-clone path and the contextual-clone path so the toggles
// affect the actual numbers used in the roll, not just the source actor's
// reference data.
function takeOverrides(ctx: Parameters<CheckRollHandler>[0]): ModifierOverrideMap | undefined {
  const opts = ctx.args.options as { modifierOverrides?: ModifierOverrideMap } | undefined
  return opts?.modifierOverrides
}

export const handleSkill: CheckRollHandler = (ctx) => {
  const slug = ctx.args.checkSubtype
  return withModifierOverrides(
    ctx.actor,
    (a) => (a as ActorPF2e).skills?.[slug] ?? null,
    takeOverrides(ctx),
    () => ctx.actor.skills[slug].check.roll(statisticParams(ctx))
  )
}

export const handleSave: CheckRollHandler = (ctx) => {
  const slug = ctx.args.checkSubtype as SaveType
  return withModifierOverrides(
    ctx.actor,
    (a) => (a as ActorPF2e).saves?.[slug] ?? null,
    takeOverrides(ctx),
    () => ctx.actor.saves[slug].check.roll(statisticParams(ctx))
  )
}

export const handlePerception: CheckRollHandler = (ctx) => {
  return withModifierOverrides(
    ctx.actor,
    (a) => (a as ActorPF2e).perception ?? null,
    takeOverrides(ctx),
    () => ctx.actor.perception.check.roll(statisticParams(ctx))
  )
}

export const handleInitiative: CheckRollHandler = (ctx) => {
  // Initiative wraps an underlying Statistic on `initiative.statistic`;
  // its check modifiers live there, not on `initiative` itself.
  const initStatGetter = (a: ActorPF2e): Statistic | null => {
    const init = (a as unknown as { initiative?: { statistic?: Statistic } }).initiative
    return init?.statistic ?? null
  }
  return withModifierOverrides(ctx.actor, initStatGetter, takeOverrides(ctx), () =>
    ctx.actor.initiative.roll(statisticParams(ctx))
  )
}
