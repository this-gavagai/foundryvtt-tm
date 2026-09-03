import type { ActorPF2e, SaveType, Statistic } from '@7h3laughingman/pf2e-types'
import { type CheckRollHandler, statisticParams } from './types'
import { checkSubtypeOf } from './subtype'
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
// Every statistic below is optional on ActorPF2e: an NPC has no class DC, a
// familiar no saves, a hazard no perception. The app gates its own UI, so a
// request that names one an actor lacks means the app's state has drifted from
// the world's — throw so the dispatch answers with an error ack rather than
// letting PF2e take a TypeError on an undefined statistic.
function requireStatistic<T>(actor: ActorPF2e, statistic: T | null | undefined, slug: string): T {
  if (!statistic) throw new Error(`${actor.name} has no ${slug} statistic`)
  return statistic
}

function takeOverrides(ctx: Parameters<CheckRollHandler>[0]): ModifierOverrideMap | undefined {
  const opts = ctx.args.options as { modifierOverrides?: ModifierOverrideMap } | undefined
  return opts?.modifierOverrides
}

export const handleSkill: CheckRollHandler = (ctx) => {
  const { slug } = checkSubtypeOf(ctx.args, 'skill')
  return withModifierOverrides(
    ctx.actor,
    (a) => a.skills?.[slug] ?? null,
    takeOverrides(ctx),
    () =>
      requireStatistic(ctx.actor, ctx.actor.skills?.[slug], slug).check.roll(statisticParams(ctx))
  )
}

// Skill actions (Demoralize, Steal, Recall Knowledge, …) roll through PF2e's
// own action machinery rather than a bare skill check, so the chat card gets the
// action's title + glyph, trait pills, target DC / degree of success, and roll
// notes natively — and emits the `self:action:slug:…` option automation keys off.
// checkSubtype = action slug; options carry the chosen statistic, any
// sub-roll-options (toggled conditional modifiers), and modifier overrides.
type SkillActionUseResult = { roll?: unknown }
type UsableAction = { use?: (options: Record<string, unknown>) => Promise<unknown> }

export const handleSkillAction: CheckRollHandler = (ctx) => {
  const { slug } = checkSubtypeOf(ctx.args, 'skillAction')
  const opts = ctx.args.options as {
    statistic?: string
    rollOptions?: string[]
    modifierOverrides?: ModifierOverrideMap
    messageMode?: string
    rollMode?: string
    variant?: string
  }
  const statisticSlug = opts?.statistic ?? ''
  const registry = (
    ctx.source.pf2e as { actions?: { get?: (s: string) => UsableAction | undefined } }
  ).actions
  const action = registry?.get?.(slug)
  if (typeof action?.use !== 'function') return Promise.resolve(null)
  const secret = opts?.messageMode === 'blind' || opts?.rollMode === 'blindroll'
  // PF2e derives skipDialog from the event's shiftKey vs the user's
  // showCheckDialogs setting; pick shiftKey so it always resolves to true.
  // ctrlKey routes a secret roll to a GM-only message.
  const event = {
    ctrlKey: secret,
    metaKey: false,
    shiftKey: !!ctx.source.user.settings.showCheckDialogs
  }
  return withModifierOverrides(
    ctx.actor,
    (a) => (a as ActorPF2e).skills?.[statisticSlug] ?? null,
    opts?.modifierOverrides,
    async () => {
      const results = (await action.use!({
        actors: [ctx.actor],
        statistic: statisticSlug,
        rollOptions: opts?.rollOptions ?? [],
        event,
        target: ctx.targetActorProxy ?? undefined,
        message: { create: true },
        // Actions declaring several variants (Create a Diversion, Perform)
        // throw unless the use() call names one; the app picks it and sends it
        // here. PF2e derives the variant's traits, notes and its own
        // `action:<slug>:<variant>` roll option from this, so nothing else
        // needs to change per variant.
        ...(opts?.variant ? { variant: opts.variant } : {})
      })) as SkillActionUseResult[] | undefined
      return results?.[0]?.roll ?? null
    }
  )
}

export const handleSave: CheckRollHandler = (ctx) => {
  const slug = checkSubtypeOf(ctx.args, 'save').slug as SaveType
  return withModifierOverrides(
    ctx.actor,
    (a) => a.saves?.[slug] ?? null,
    takeOverrides(ctx),
    () =>
      requireStatistic(ctx.actor, ctx.actor.saves?.[slug], slug).check.roll(statisticParams(ctx))
  )
}

export const handlePerception: CheckRollHandler = (ctx) => {
  return withModifierOverrides(
    ctx.actor,
    (a) => a.perception ?? null,
    takeOverrides(ctx),
    () =>
      requireStatistic(ctx.actor, ctx.actor.perception, 'perception').check.roll(
        statisticParams(ctx)
      )
  )
}

export const handleFamiliarAttack: CheckRollHandler = (ctx) => {
  const attackStatisticGetter = (a: ActorPF2e): Statistic | null =>
    a.isOfType('familiar') ? a.attackStatistic : null
  return withModifierOverrides(
    ctx.actor,
    attackStatisticGetter,
    takeOverrides(ctx),
    async () => (await attackStatisticGetter(ctx.actor)?.check.roll(statisticParams(ctx))) ?? null
  )
}

export const handleInitiative: CheckRollHandler = (ctx) => {
  // Initiative wraps an underlying Statistic on `initiative.statistic`;
  // its check modifiers live there, not on `initiative` itself.
  const initStatGetter = (a: ActorPF2e): Statistic | null => a.initiative?.statistic ?? null
  return withModifierOverrides(ctx.actor, initStatGetter, takeOverrides(ctx), () =>
    requireStatistic(ctx.actor, ctx.actor.initiative, 'initiative').roll(statisticParams(ctx))
  )
}
