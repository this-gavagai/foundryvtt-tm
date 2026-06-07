import { findSpell } from '@/foundry/utils/spellLookup'
import { makeCastRankEvent } from '@/foundry/utils/roll'
import { type CheckRollHandler, statisticParams } from './types'
import {
  withDamageModifierOverrides,
  withModifierOverrides,
  type ModifierOverrideMap
} from './modifierOverrides'

// Subtype is either "entryId" (legacy entry-level attack from the entry modal)
// or "entryId,spellId,attackNumber" for the per-spell attack buttons in the
// spell info modal (attackNumber 1/2/3 = MAP 0/-5/-10).
export const handleSpellAttack: CheckRollHandler = (ctx) => {
  const [entryId, spellId, attackNumberStr] = ctx.args.checkSubtype.split(',')
  const overrides = (ctx.args.options as { modifierOverrides?: ModifierOverrideMap })
    ?.modifierOverrides
  const rollParams = statisticParams(ctx)
  return withModifierOverrides(
    ctx.actor,
    (actor) => (entryId ? actor.spellcasting?.get(entryId)?.statistic : null),
    overrides,
    async () => {
      if (spellId) {
        const spell = findSpell(ctx.actor, spellId)
        return (
          (await spell?.rollAttack(ctx.params.event, Number(attackNumberStr || '1'), rollParams)) ??
          null
        )
      }
      return (await ctx.actor.spellcasting?.get(entryId)?.statistic?.check.roll(rollParams)) ?? null
    }
  )
}

// Subtype: "spellId,mapIncreases,castingRank". Synthesize an event whose
// target carries [data-cast-rank=<rank>]; SpellPF2e.rollDamage reads it via
// htmlClosest and runs its own loadVariant + heightening dispatch — no hand-
// rolled heightening required on our side.
export const handleSpellDamage: CheckRollHandler = ({ source, actor, args }) => {
  const [spellId, mapIncreasesStr, castingRankStr] = args.checkSubtype.split(',')
  const spell = findSpell(actor, spellId)
  const castingRank = castingRankStr ? Number(castingRankStr) : undefined
  const mapIncreases = Number(mapIncreasesStr || '0') as 0 | 1 | 2
  const overrides = (args.options as { modifierOverrides?: ModifierOverrideMap })?.modifierOverrides
  return withDamageModifierOverrides(
    overrides,
    async () =>
      (await spell?.rollDamage(makeCastRankEvent(source, castingRank), mapIncreases)) ?? null
  )
}
