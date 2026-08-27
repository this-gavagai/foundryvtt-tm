// Spell variants ("Heal (vs. Living) ◆◆", "Heal ◆◆◆"), derived from the
// overlays stored on the spell item.
//
// PF2e builds the same list for a posted spell card, but it does it the
// expensive way: loadVariant() every override overlay and read `name` /
// `actionGlyph` off the resulting spell (SpellPF2e#getChatData). That needs the
// system's document classes, which only exist on a Foundry client — so the app
// derives the two display fields from the stored overlay instead.
//
// The derivation is exact for `overlayType: "override"`, which is the only type
// that becomes a variant: an override's `system` is a shallow patch over the
// spell's own, so a field it omits is the spell's field. That's why an overlay
// with no `name` shows the spell's name (Heal's 1- and 3-action overlays carry
// no name at all and read as plain "Heal"), and why the action glyph falls back
// the same way.
//
// Other overlay types are heightening data, not castable variants, and are
// skipped — matching PF2e's `overrideVariants`.

export interface SpellVariant {
  // The overlay's own id, which is what a cast or a card rewrite is keyed on.
  overlayId: string
  label: string
  // Action cost as PF2e's glyph font renders it ("1", "2", "3", "R"…); absent
  // when neither the overlay nor the spell states one.
  actionGlyph?: string
  sort: number
}

interface OverlaySource {
  name?: string | null
  overlayType?: string | null
  sort?: number | null
  system?: { time?: { value?: string | null } | null } | null
}

interface SpellSource {
  name?: string | null
  system?: {
    time?: { value?: string | null } | null
    overlays?: Record<string, OverlaySource> | null
  } | null
}

export function spellVariants(spell: SpellSource | null | undefined): SpellVariant[] {
  const overlays = spell?.system?.overlays
  if (!overlays) return []
  const spellGlyph = spell?.system?.time?.value ?? undefined

  return Object.entries(overlays)
    .filter(([, overlay]) => overlay?.overlayType === 'override')
    .map(([overlayId, overlay]) => ({
      overlayId,
      label: overlay.name || spell?.name || '',
      actionGlyph: overlay.system?.time?.value ?? spellGlyph ?? undefined,
      sort: overlay.sort ?? 0
    }))
    .sort((a, b) => a.sort - b.sort)
}
