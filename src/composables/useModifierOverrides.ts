import { computed, ref, type Ref } from 'vue'
import type { Modifier } from '@/composables/character'

export function useModifierOverrides(modifiers: Ref<Modifier[] | undefined>) {
  const modifierOverrides = ref<Record<string, boolean>>({})

  function toggleModifier(mod: Modifier) {
    const slug = mod.slug
    if (!slug) return
    const next = { ...modifierOverrides.value }
    if (slug in next) delete next[slug]
    else next[slug] = !mod.enabled
    modifierOverrides.value = next
  }

  function effectiveEnabled(mod: Modifier): boolean {
    const slug = mod.slug
    if (slug && slug in modifierOverrides.value) return modifierOverrides.value[slug]
    return !!mod.enabled
  }

  function isManuallyActivated(mod: Modifier): boolean {
    const slug = mod.slug
    if (!slug || !(slug in modifierOverrides.value)) return false
    return modifierOverrides.value[slug] === true && !mod.enabled
  }

  function isManuallyDeactivated(mod: Modifier): boolean {
    const slug = mod.slug
    if (!slug || !(slug in modifierOverrides.value)) return false
    return modifierOverrides.value[slug] === false && !!mod.enabled
  }

  const stackingLosers = computed<Set<string>>(() => {
    const losers = new Set<string>()
    const byType: Record<string, Modifier[]> = {}
    for (const mod of modifiers.value ?? []) {
      if (!effectiveEnabled(mod)) continue
      const type = mod.type ?? 'untyped'
      if (type === 'untyped') continue
      ;(byType[type] ??= []).push(mod)
    }
    for (const bucket of Object.values(byType)) {
      const positives = bucket.filter((mod) => (mod.modifier ?? 0) >= 0)
      const negatives = bucket.filter((mod) => (mod.modifier ?? 0) < 0)
      const claim = (winners: Modifier[], better: (a: number, b: number) => boolean) => {
        if (winners.length <= 1) return
        let best = winners[0]
        for (let i = 1; i < winners.length; i++) {
          if (better(winners[i].modifier ?? 0, best.modifier ?? 0)) best = winners[i]
        }
        for (const mod of winners) {
          if (mod !== best && mod.slug) losers.add(mod.slug)
        }
      }
      claim(positives, (a, b) => a > b)
      claim(negatives, (a, b) => a < b)
    }
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
