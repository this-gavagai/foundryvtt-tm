import { computed, ref, type Ref } from 'vue'
import type { Modifier } from '@/composables/character'
import { stackingOutcome } from '@/utils/ruleEngine/flatModifiers'

export function useModifierOverrides(
  modifiers: Ref<Modifier[] | undefined>,
  // When provided, modifiers with critical===true are treated as disabled in a
  // non-critical context and enabled in a critical context (and vice versa for
  // critical===false), independently of their server-side enabled state.
  criticalContext?: Ref<boolean>
) {
  const modifierOverrides = ref<Record<string, boolean>>({})

  function effectiveEnabled(mod: Modifier): boolean {
    const slug = mod.slug
    if (slug && slug in modifierOverrides.value) return modifierOverrides.value[slug]
    const isCritical = criticalContext?.value ?? false
    if (mod.critical === true && !isCritical) return false
    if (mod.critical === false && isCritical) return false
    return !!mod.enabled
  }

  function toggleModifier(mod: Modifier) {
    const slug = mod.slug
    if (!slug) return
    const next = { ...modifierOverrides.value }
    if (slug in next) delete next[slug]
    // Use effectiveEnabled so toggling a crit-only modifier in normal context
    // correctly queues an "enable" override rather than a redundant "disable".
    else next[slug] = !effectiveEnabled(mod)
    modifierOverrides.value = next
  }

  function isManuallyActivated(mod: Modifier): boolean {
    const slug = mod.slug
    if (!slug || !(slug in modifierOverrides.value)) return false
    return modifierOverrides.value[slug] === true
  }

  function isManuallyDeactivated(mod: Modifier): boolean {
    const slug = mod.slug
    if (!slug || !(slug in modifierOverrides.value)) return false
    return modifierOverrides.value[slug] === false
  }

  // PF2e's stacking rule, run through the ENGINE's implementation rather than a
  // second copy of it.
  //
  // This used to reimplement the contest here, and the two had already drifted:
  // this copy knew nothing of `force`, split ability modifiers by sign where
  // PF2e contests them as one group, and gave ties to the first entry where
  // PF2e gives them to the last. One rule, one implementation now; the seam is
  // `effectiveEnabled`, which is the only part that is genuinely this file's —
  // the contest has to be re-run against what the PLAYER has toggled, and
  // neither PF2e nor the engine knows that.
  const stackingLosers = computed<Set<string>>(() => {
    const mods = modifiers.value ?? []
    const applies = stackingOutcome(mods, effectiveEnabled)
    const losers = new Set<string>()
    mods.forEach((mod, index) => {
      // Lost the CONTEST, as against merely being out of play. Only the former
      // earns the outranked styling — a switched-off modifier is already greyed,
      // and an `ignored` one (unequipped, uninvested) never entered a contest to
      // lose, so calling it outranked would explain it wrongly.
      if (!applies[index] && effectiveEnabled(mod) && !mod.ignored && mod.slug) losers.add(mod.slug)
    })
    return losers
  })

  function isStackingLoser(mod: Modifier): boolean {
    return !!mod.slug && stackingLosers.value.has(mod.slug)
  }

  return {
    modifierOverrides,
    toggleModifier,
    effectiveEnabled,
    isManuallyActivated,
    isManuallyDeactivated,
    stackingLosers,
    isStackingLoser
  }
}
