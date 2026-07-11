import { findSpell } from '@/foundry/utils/spellLookup'
import { makeCastRankEvent } from '@/foundry/utils/roll'
import { noFallbackTargetActor, resolveTarget } from '@/foundry/utils/target'
import { rollSpellDamageWithTarget } from '@/foundry/utils/spellTargeting'
import { type CheckRollContext, type CheckRollHandler, statisticParams } from './types'
import { checkSubtypeOf } from './subtype'
import {
  withDamageModifierOverrides,
  withModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

// Subtype carries entryId alone (entry-level attack from the entry modal) or
// entryId + spellId + attackNumber for the per-spell attack buttons in the
// spell info modal (attackNumber 1/2/3 = MAP 0/-5/-10).
function spellAttackParams(ctx: CheckRollContext) {
  return {
    ...statisticParams(ctx),
    target: ctx.targetActorProxy ?? noFallbackTargetActor(ctx.actor)
  }
}

export const handleSpellAttack: CheckRollHandler = (ctx) => {
  const { entryId, spellId, attackNumber } = checkSubtypeOf(ctx.args, 'spellAttack')
  const overrides = (ctx.args.options as { modifierOverrides?: ModifierOverrideMap })
    ?.modifierOverrides
  const rollParams = spellAttackParams(ctx)
  return withModifierOverrides(
    ctx.actor,
    (actor) => (entryId ? actor.spellcasting?.get(entryId)?.statistic : null),
    overrides,
    async () => {
      if (spellId) {
        const spell = findSpell(ctx.actor, spellId, entryId)
        return (await spell?.rollAttack(ctx.params.event, attackNumber ?? 1, rollParams)) ?? null
      }
      return (await ctx.actor.spellcasting?.get(entryId)?.statistic?.check.roll(rollParams)) ?? null
    }
  )
}

// Subtype: spellId + mapIncreases + castingRank. Synthesize an event whose
// target carries [data-cast-rank=<rank>]; SpellPF2e.rollDamage reads it via
// htmlClosest and runs its own loadVariant + heightening dispatch — no hand-
// rolled heightening required on our side.
export const handleSpellDamage: CheckRollHandler = ({ source, actor, args }) => {
  const { spellId, mapIncreases, castingRank } = checkSubtypeOf(args, 'spellDamage')
  const baseSpell = findSpell(actor, spellId)
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const spell = castingRank
    ? ((baseSpell?.loadVariant({ castRank: castingRank }) as typeof baseSpell) ?? baseSpell)
    : baseSpell
  const { tokenDoc } = resolveTarget(source, args.targets)
  return withDamageModifierOverrides(
    overrides,
    async () =>
      (spell
        ? await rollSpellDamageWithTarget(
            spell,
            makeCastRankEvent(source, castingRank),
            mapIncreases,
            tokenDoc
          )
        : null) ?? null
  )
}
