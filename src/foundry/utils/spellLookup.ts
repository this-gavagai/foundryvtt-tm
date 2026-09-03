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
  spellId: string,
  entryId?: string
): SpellPF2e<ActorPF2e> | undefined {
  type SpellCol = { get: (id: string) => SpellPF2e<ActorPF2e> | undefined }
  type CollectionsMap = { get: (id: string) => SpellCol | undefined; values(): Iterable<SpellCol> }
  const collections = (
    actor.spellcasting as typeof actor.spellcasting & { collections: CollectionsMap }
  ).collections
  const entrySpell = entryId ? collections.get(entryId)?.get(spellId) : undefined
  if (entrySpell) return entrySpell

  for (const col of collections.values()) {
    const found = col.get(spellId)
    if (found) return found
  }
  return actor.items.get(spellId) as SpellPF2e<ActorPF2e> | undefined
}

// Resolve the exact spell a roll should be made with: the base item, heightened
// to `castRank`, with any spell-variant `overlayIds` applied.
//
// Both arguments describe a CAST rather than an item — they come from a posted
// chat card, whose variant buttons produce a spell PF2e treats as a distinct
// (transient) document. loadVariant is the system's own way to build it, and it
// is what PF2e's chat-card handler calls; going through it means heightening,
// overlay damage/traits, and the spellcasting context all resolve the way the
// system would resolve them.
//
// loadVariant returns null when there is nothing to apply (no overlays and a
// castRank equal to the spell's current rank), which is exactly the case where
// the base spell is already correct — hence the fallback rather than a throw.
export function loadSpellVariant(
  spell: SpellPF2e<ActorPF2e> | undefined,
  options: { castRank?: number; overlayIds?: string[] }
): SpellPF2e<ActorPF2e> | undefined {
  if (!spell) return undefined
  const overlayIds = options.overlayIds?.length ? options.overlayIds : undefined
  if (!overlayIds && !options.castRank) return spell
  const variant = spell.loadVariant({
    ...(overlayIds ? { overlayIds } : {}),
    ...(options.castRank ? { castRank: options.castRank } : {})
  }) as SpellPF2e<ActorPF2e> | null
  return variant ?? spell
}
