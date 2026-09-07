import { computed, ref, type Ref } from 'vue'
import type { Modifier } from '@/composables/character'
import { resolveModifierList } from '@/utils/ruleEngine/flatModifiers'

// One modifier list, one resolution, and every answer the panel needs derived
// from it.
//
// The list arrives already resolved once — by PF2e, or by the engine — and the
// moment a player taps a row it has to be resolved again, because toggling
// changes who wins and neither PF2e nor the engine knows what was tapped. That
// re-run is `resolveModifierList`: PF2e's per-slug collapse, then its stacking
// contest per damage partition, with `effectiveEnabled` as the seam.
//
// Everything below reads that ONE verdict. It used to be three separate answers
// — a set of losing slugs, a per-modifier enabled test, and a total each caller
// summed for itself — and they disagreed, which is how a preview came to promise
// a number the roll would not land.
export function useModifierOverrides(
  modifiers: Ref<Modifier[] | undefined>,
  // When provided, modifiers with critical===true are treated as disabled in a
  // non-critical context and enabled in a critical context (and vice versa for
  // critical===false), independently of their server-side enabled state.
  criticalContext?: Ref<boolean>
) {
  const modifierOverrides = ref<Record<string, boolean>>({})

  const list = computed<Modifier[]>(() => modifiers.value ?? [])
  const hasOverrides = computed(() => Object.keys(modifierOverrides.value).length > 0)

  function overrideFor(mod: Modifier): boolean | undefined {
    const slug = mod.slug
    if (!slug || !(slug in modifierOverrides.value)) return undefined
    return modifierOverrides.value[slug]
  }

  // What the row would say with nobody having touched it. Split out from
  // `effectiveEnabled` because the delta needs a baseline to measure against.
  function defaultEnabled(mod: Modifier): boolean {
    const isCritical = criticalContext?.value ?? false
    if (mod.critical === true && !isCritical) return false
    if (mod.critical === false && isCritical) return false
    return !!mod.enabled
  }

  function effectiveEnabled(mod: Modifier): boolean {
    return overrideFor(mod) ?? defaultEnabled(mod)
  }

  // A toggle moves `ignored` as well as `enabled`, because that is what the
  // server does with it: `applyOverridesToModifiers` sets `ignored = !want`
  // beside `enabled = want`.
  //
  // Reading `ignored` straight off the wire instead barred a whole class of
  // modifiers from the contest. PF2e's `Modifier#test()` sets
  // `ignored = !enabled` on EVERY predicate failure — not only on unequipped or
  // uninvested gear, which is what this once assumed — so the default-off,
  // condition-gated rows a player actually taps all arrive `ignored: true`.
  // Switched on, such a row entered no contest: it outranked nothing, was marked
  // as no one's loser, and was nevertheless added to the preview total. The
  // server contested it properly, so the roll came in below what the panel
  // promised.
  const contestable = computed<Modifier[]>(() =>
    list.value.map((mod) => {
      const override = overrideFor(mod)
      return override === undefined ? mod : { ...mod, ignored: !override }
    })
  )

  const resolved = computed(() => resolveModifierList(contestable.value, effectiveEnabled))
  const untouched = computed(() => resolveModifierList(list.value, defaultEnabled))

  const sum = (applies: boolean[]) =>
    list.value.reduce(
      (total, mod, index) => (applies[index] ? total + (mod.modifier ?? 0) : total),
      0
    )

  // What the modifiers on this list add up to, as toggled. Only meaningful where
  // the list is the WHOLE of a statistic's arithmetic; where PF2e sent a total of
  // its own, prefer that plus `overrideDelta`.
  const effectiveTotal = computed<number>(() => sum(resolved.value.applies))

  // What the player's toggles are worth, and nothing else.
  //
  // A preview anchored on PF2e's own number plus this delta cannot disagree with
  // the sheet at rest, and survives any systematic gap between the local
  // simulation and the system's. Anchoring on `effectiveTotal` instead means
  // every such gap shows up as a stat box and a roll button quoting different
  // numbers for the same roll.
  const overrideDelta = computed<number>(() =>
    hasOverrides.value ? effectiveTotal.value - sum(untouched.value.applies) : 0
  )

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
    return overrideFor(mod) === true
  }

  function isManuallyDeactivated(mod: Modifier): boolean {
    return overrideFor(mod) === false
  }

  // Answers keyed by ROW, not by slug.
  //
  // `resolveModifierList` returns one verdict per input index precisely because
  // slugs are not unique — and this used to collapse that verdict into a
  // `Set<string>` of losing slugs, reintroducing the ambiguity the shape exists
  // to avoid. A statistic carrying the same slug twice had both copies struck
  // through and the bonus dropped from the total entirely.
  function appliesAt(index: number): boolean {
    return resolved.value.applies[index] ?? false
  }

  // The same modifier seen twice — PF2e keeps one and discards the rest, so
  // there is no second modifier for a reader to learn about. Not a contest
  // result: nothing was outranked.
  function isSuperseded(index: number): boolean {
    return resolved.value.distinct[index] === false
  }

  // Lost the CONTEST, as against merely being out of play. Only the former earns
  // the outranked styling — a switched-off modifier is already greyed, and a
  // duplicate never competed.
  function isOutranked(index: number): boolean {
    const mod = list.value[index]
    if (!mod || isSuperseded(index) || appliesAt(index)) return false
    return effectiveEnabled(mod)
  }

  // A row PF2e can be TOLD about instead of overridden.
  //
  // `enableOptions` are the roll options the modifier's predicate is waiting on,
  // lifted GM-side for a skill action's own modifiers and by the engine for a
  // conditional it resolved. Supplying them lets PF2e's evaluator answer its own
  // predicate — "feed it" rather than "amputate it", the order the rule engine's
  // README puts these in — and it is the more reliable of the two: an override
  // binds by slug, and a slug the app reconstructed from a label is silently
  // ignored by `applyOverridesToModifiers` when it does not match.
  const isFed = (mod: Modifier): boolean => !!mod.enableOptions?.length
  const fedRows = computed(() => list.value.filter(isFed))

  // The options to declare for this roll: every fed row that is on. A fed row
  // that is OFF contributes nothing, which is already how PF2e reads an option
  // that was never declared.
  function enabledOptions(): string[] {
    const options = fedRows.value
      .filter((mod) => effectiveEnabled(mod))
      .flatMap((mod) => mod.enableOptions ?? [])
    return [...new Set(options)]
  }

  // The payload for the roll. `undefined` rather than `{}` so a request carries
  // the key only when the player actually set something.
  //
  // Fed rows are NOT excluded, deliberately. Both channels go out, and they push
  // the same direction: the option makes the toggle work when the slug does not
  // bind, and the override makes it work on a roll path with no option channel
  // to carry it. Excluding them would trade one silent failure for another,
  // since not every RPC here can carry roll options.
  function overridePayload(): Record<string, boolean> | undefined {
    return hasOverrides.value ? { ...modifierOverrides.value } : undefined
  }

  function reset() {
    modifierOverrides.value = {}
  }

  return {
    modifierOverrides,
    hasOverrides,
    overridePayload,
    reset,
    enabledOptions,
    toggleModifier,
    effectiveEnabled,
    isManuallyActivated,
    isManuallyDeactivated,
    appliesAt,
    isSuperseded,
    isOutranked,
    effectiveTotal,
    overrideDelta
  }
}

// What `ModifierOverrideList` needs from the composable, so a call site hands it
// one object instead of threading five callbacks by hand.
export type ModifierControls = ReturnType<typeof useModifierOverrides>
