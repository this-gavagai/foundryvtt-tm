import { findSpell } from '@/foundry/utils/spell'
import { makeCastRankEvent } from '@/foundry/utils/roll'
import { type CheckRollHandler, statisticParams } from './types'

// Subtype is either "entryId" (legacy entry-level attack from the entry modal)
// or "entryId,spellId,attackNumber" for the per-spell attack buttons in the
// spell info modal (attackNumber 1/2/3 = MAP 0/-5/-10).
export const handleSpellAttack: CheckRollHandler = (ctx) => {
  const [entryId, spellId, attackNumberStr] = ctx.args.checkSubtype.split(',')
  const rollParams = statisticParams(ctx)
  if (spellId) {
    const spell = findSpell(ctx.actor, spellId)
    return spell?.rollAttack(ctx.params.event, Number(attackNumberStr || '1'), rollParams)
  }
  return ctx.actor.spellcasting.get(entryId)?.statistic?.check.roll(rollParams)
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
  return spell?.rollDamage(makeCastRankEvent(source, castingRank), mapIncreases)
}
