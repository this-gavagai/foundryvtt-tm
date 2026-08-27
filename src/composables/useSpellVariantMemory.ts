import { ref } from 'vue'

// Which variant each spell was last USED with — the cast that was made, or the
// attack/damage that was rolled.
//
// This is a DEFAULT, never a constraint. Casting Heal (vs. Undead) and then
// rolling its damage as (vs. Living) is a legitimate thing to do — Foundry
// imposes no link between the two either, since a variant lives on a chat card
// and each roll resolves its own. So the choice stays freely changeable
// everywhere it appears; remembering it only spares the player from re-picking
// the same option every time.
//
// Written when an action actually happens, not when the selector is touched.
// Comparing "what would melee do?" in a damage preview and closing it again is
// browsing, and must not silently change what the next cast defaults to.
//
// Module-scoped (see useOverlayStack for the same pattern): one memory shared by
// the spell list and the roll modal, which is the point — they are separate
// components expressing one running choice. Deliberately not persisted; a fresh
// session starting from each spell's first variant is the honest default.
const lastUsed = ref<Record<string, string>>({})

export function useSpellVariantMemory() {
  function rememberVariant(spellId: string | null | undefined, overlayId: string | undefined) {
    if (!spellId || !overlayId) return
    lastUsed.value = { ...lastUsed.value, [spellId]: overlayId }
  }

  // The remembered variant, if it is still one the spell offers. A spell's
  // overlays can change under us (a staff re-prepared, an item edited), and a
  // stale id would select nothing and leave the control looking unset.
  function lastVariant(
    spellId: string | null | undefined,
    available: readonly { overlayId: string }[]
  ): string | undefined {
    if (!spellId) return undefined
    const remembered = lastUsed.value[spellId]
    return remembered && available.some((v) => v.overlayId === remembered) ? remembered : undefined
  }

  return { rememberVariant, lastVariant }
}
