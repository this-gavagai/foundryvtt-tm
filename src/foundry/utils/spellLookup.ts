import type { ActorPF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'

// Locate a SpellPF2e by id. Prefer the entry-bound spell from
// actor.spellcasting.collections — it carries the spellcasting context PF2e
// needs for loadVariant / getDamage to apply heightening correctly. The bare
// actor.items.get() entry doesn't have that context, so loadVariant returns
// null on it and damage silently rolls at the base rank. Fall back to
// actor.items.get() for spells that aren't registered in any entry's
// collection (rare — typically rule-element-granted spells).
export function findSpell(
  actor: ActorPF2e,
  spellId: string
): SpellPF2e<ActorPF2e> | undefined {
  type SpellCol = { get: (id: string) => SpellPF2e<ActorPF2e> | undefined }
  type CollectionsMap = { values(): Iterable<SpellCol> }
  const collections = (actor.spellcasting as typeof actor.spellcasting & { collections: CollectionsMap })
    .collections
  for (const col of collections.values()) {
    const found = col.get(spellId)
    if (found) return found
  }
  return actor.items.get(spellId) as SpellPF2e<ActorPF2e> | undefined
}
