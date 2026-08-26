import { findSpell, loadSpellVariant } from '@/foundry/utils/spellLookup'
import { makeCastRankEvent } from '@/foundry/utils/roll'
import { rollSpellDamageWithTarget } from '@/foundry/utils/spellTargeting'
import { type CheckRollHandler, statisticParams } from './types'
import { checkSubtypeOf } from './subtype'
import {
  withDamageModifierOverrides,
  withModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

// Subtype carries entryId alone (entry-level attack from the entry modal) or
// entryId + spellId + attackNumber for the per-spell attack buttons in the
// spell info modal (attackNumber 1/2/3 = MAP 0/-5/-10).
//
// The no-target stand-in this path used to apply itself now lives in
// statisticParams, which every statistic-based check goes through.
export const handleSpellAttack: CheckRollHandler = (ctx) => {
  const { entryId, spellId, attackNumber, castingRank, overlayIds } = checkSubtypeOf(
    ctx.args,
    'spellAttack'
  )
  const overrides = (ctx.args.options as { modifierOverrides?: ModifierOverrideMap })
    ?.modifierOverrides
  const rollParams = statisticParams(ctx)
  return withModifierOverrides(
    ctx.actor,
    (actor) => (entryId ? actor.spellcasting?.get(entryId)?.statistic : null),
    overrides,
    async () => {
      if (spellId) {
        // castingRank/overlayIds arrive only from a posted chat card, where the
        // roll belongs to that card's cast rather than to the base spell.
        const spell = loadSpellVariant(findSpell(ctx.actor, spellId, entryId), {
          castRank: castingRank,
          overlayIds
        })
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
export const handleSpellDamage: CheckRollHandler = ({ source, actor, args, targets }) => {
  const { spellId, mapIncreases, castingRank, overlayIds } = checkSubtypeOf(args, 'spellDamage')
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  const spell = loadSpellVariant(findSpell(actor, spellId), {
    castRank: castingRank,
    overlayIds
  })
  return withDamageModifierOverrides(
    overrides,
    async () =>
      (spell
        ? await rollSpellDamageWithTarget(
            spell,
            makeCastRankEvent(source, castingRank),
            mapIncreases,
            targets.tokenDoc
          )
        : null) ?? null
  )
}
