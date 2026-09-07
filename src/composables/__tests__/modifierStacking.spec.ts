// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import type { Modifier } from '@/composables/character/defs/modifier'

// The sheet re-resolves a modifier list on every toggle, because toggling changes
// who wins and neither PF2e nor the engine knows what was toggled. That is a real
// need — but it used to be met by a SECOND implementation of the rule living
// here, and the two had drifted: this one knew nothing of `force`, split ability
// modifiers by sign where PF2e contests them as one group, and gave ties to the
// first entry where PF2e gives them to the last.
//
// It now calls the engine's `resolveModifierList`. These tests exist to keep it
// calling it — each case in the first block is one the local copy got wrong.

const mod = (over: Partial<Modifier>): Modifier => ({
  slug: 'm',
  label: 'M',
  modifier: 0,
  enabled: true,
  hideIfDisabled: false,
  type: 'untyped',
  critical: undefined,
  force: undefined,
  ignored: undefined,
  diceNumber: undefined,
  dieSize: undefined,
  damageType: undefined,
  damageCategory: undefined,
  enableOptions: undefined,
  ...over
})

// Which rows the panel strikes through, by slug — the readable form of an
// index-keyed answer. Only safe to key by slug in a test that has no duplicates;
// the duplicate cases below address rows by index for exactly that reason.
const outrankedIn = (modifiers: Modifier[]) => {
  const { isOutranked } = useModifierOverrides(ref(modifiers))
  return modifiers.filter((_, index) => isOutranked(index)).map((m) => m.slug)
}

describe('the contest the sheet re-runs', () => {
  it('marks the smaller of a type as outranked', () => {
    expect(
      outrankedIn([
        mod({ slug: 'big', type: 'status', modifier: 2 }),
        mod({ slug: 'small', type: 'status', modifier: 1 })
      ])
    ).toEqual(['small'])
  })

  it('lets untyped modifiers all stand', () => {
    expect(outrankedIn([mod({ slug: 'a', modifier: 1 }), mod({ slug: 'b', modifier: 2 })])).toEqual(
      []
    )
  })

  it('gives a tie to the later entry, as PF2e does', () => {
    expect(
      outrankedIn([
        mod({ slug: 'first', type: 'item', modifier: 2 }),
        mod({ slug: 'second', type: 'item', modifier: 2 })
      ])
    ).toEqual(['first'])
  })

  it('contests ability modifiers as one group across both signs', () => {
    // Not a bonus and a penalty side by side: one survivor.
    expect(
      outrankedIn([
        mod({ slug: 'dex', type: 'ability', modifier: 4 }),
        mod({ slug: 'drained', type: 'ability', modifier: -1 })
      ])
    ).toEqual(['drained'])
  })

  it('lets a forced ability modifier beat a larger one', () => {
    expect(
      outrankedIn([
        mod({ slug: 'dex', type: 'ability', modifier: 4 }),
        mod({ slug: 'forced', type: 'ability', modifier: 1, force: true })
      ])
    ).toEqual(['dex'])
  })

  it('makes a forced modifier of any other type compete normally', () => {
    expect(
      outrankedIn([
        mod({ slug: 'big', type: 'status', modifier: 2 }),
        mod({ slug: 'forced', type: 'status', modifier: 1, force: true })
      ])
    ).toEqual(['forced'])
  })

  it('does not call a switched-off modifier outranked', () => {
    // Greyed and struck-through mean different things to a reader: one is "you
    // turned this off", the other "something better applies".
    expect(
      outrankedIn([
        mod({ slug: 'on', type: 'status', modifier: 2 }),
        mod({ slug: 'off', type: 'status', modifier: 1, enabled: false })
      ])
    ).toEqual([])
  })

  it('re-runs the contest when the player toggles one on', () => {
    const modifiers = [
      mod({ slug: 'on', type: 'status', modifier: 1 }),
      mod({ slug: 'off', type: 'status', modifier: 3, enabled: false })
    ]
    const { isOutranked, toggleModifier } = useModifierOverrides(ref(modifiers))
    expect(isOutranked(0)).toBe(false)
    // Switching the bigger one on has to outrank the smaller one — the whole
    // reason this cannot be answered once on the server.
    toggleModifier(modifiers[1])
    expect(isOutranked(0)).toBe(true)
  })
})

// PF2e's `Modifier#test()` sets `ignored = !enabled` on EVERY predicate failure,
// so the default-off, condition-gated rows a player actually taps all arrive
// `ignored: true`. Reading that field straight off the wire — on the theory that
// it meant "unequipped or uninvested gear" — barred them from the contest even
// after the player switched them on.
describe('a modifier the player switches on enters the contest', () => {
  const pair = () => [
    mod({ slug: 'worn', type: 'item', modifier: 1 }),
    // As PF2e sends a modifier whose predicate did not pass.
    mod({ slug: 'conditional', type: 'item', modifier: 3, enabled: false, ignored: true })
  ]

  it('outranks a smaller sibling instead of joining it', () => {
    const modifiers = pair()
    const { toggleModifier, isOutranked } = useModifierOverrides(ref(modifiers))
    toggleModifier(modifiers[1])
    expect(isOutranked(0)).toBe(true)
    expect(isOutranked(1)).toBe(false)
  })

  it('adds only the winner to the total', () => {
    const modifiers = pair()
    const { toggleModifier, effectiveTotal, overrideDelta } = useModifierOverrides(ref(modifiers))
    expect(effectiveTotal.value).toBe(1)
    toggleModifier(modifiers[1])
    // Not 4. The server contests it properly, so a preview of 4 promised a point
    // the roll was never going to land.
    expect(effectiveTotal.value).toBe(3)
    expect(overrideDelta.value).toBe(2)
  })

  it('still keeps an untouched ignored modifier out of the contest', () => {
    // An unequipped item's modifier does not outrank anything, and is not itself
    // reported as outranked — it simply is not in play.
    expect(
      outrankedIn([
        mod({ slug: 'held', type: 'item', modifier: 1 }),
        mod({ slug: 'in-the-bag', type: 'item', modifier: 3, enabled: false, ignored: true })
      ])
    ).toEqual([])
  })
})

// `extractModifiers` yields one instance per matching domain, so a rule with
// `selector: ["stealth", "skill-check"]` lands twice. PF2e collapses by slug
// inside every `StatisticModifier`, but `getTraceData` sends `check.modifiers`
// raw — pre-collapse — beside a `totalModifier` that is post-collapse.
describe('the same modifier sent twice', () => {
  const duplicated = () => [
    mod({ slug: 'dex', type: 'ability', modifier: 4 }),
    mod({ slug: 'sneaky', type: 'circumstance', modifier: 2 }),
    mod({ slug: 'sneaky', type: 'circumstance', modifier: 2 })
  ]

  it('counts once, not zero times and not twice', () => {
    const { effectiveTotal } = useModifierOverrides(ref(duplicated()))
    // The slug-keyed loser set used to strike BOTH copies and drop the bonus
    // altogether, reporting 4 where PF2e reports 6.
    expect(effectiveTotal.value).toBe(6)
  })

  it('hides the discarded copy rather than calling it outranked', () => {
    const modifiers = duplicated()
    const { isSuperseded, isOutranked } = useModifierOverrides(ref(modifiers))
    expect([0, 1, 2].map(isSuperseded)).toEqual([false, false, true])
    // Nothing was outranked: one modifier listed twice is not two modifiers
    // that stack badly.
    expect([0, 1, 2].map(isOutranked)).toEqual([false, false, false])
  })

  it('keeps the larger magnitude, as PF2e does', () => {
    const { effectiveTotal, isSuperseded } = useModifierOverrides(
      ref([
        mod({ slug: 'shaky', type: 'circumstance', modifier: -1 }),
        mod({ slug: 'shaky', type: 'circumstance', modifier: -3 })
      ])
    )
    expect(effectiveTotal.value).toBe(-3)
    expect(isSuperseded(0)).toBe(true)
  })
})

// PF2e's damage dialog runs the contest twice, over two partitions:
//   applyStackingRules(modifiers.filter((m) => m.category !== 'persistent'))
//   applyStackingRules(modifiers.filter((m) => m.category === 'persistent'))
describe('persistent damage is its own pool', () => {
  it('does not contest a persistent bonus against an ordinary one', () => {
    const modifiers = [
      mod({ slug: 'inspired', type: 'status', modifier: 1 }),
      mod({ slug: 'burning', type: 'status', modifier: 3, damageCategory: 'persistent' })
    ]
    const { isOutranked, effectiveTotal } = useModifierOverrides(ref(modifiers))
    expect([0, 1].map(isOutranked)).toEqual([false, false])
    expect(effectiveTotal.value).toBe(4)
  })

  it('still contests two persistent modifiers of the same type', () => {
    expect(
      outrankedIn([
        mod({ slug: 'big-burn', type: 'status', modifier: 3, damageCategory: 'persistent' }),
        mod({ slug: 'small-burn', type: 'status', modifier: 1, damageCategory: 'persistent' })
      ])
    ).toEqual(['small-burn'])
  })
})

// Critical-only rows read differently depending on which button opened the
// panel, and the delta has to follow.
describe('critical context', () => {
  const deadly = () => [
    mod({ slug: 'strength', type: 'untyped', modifier: 4 }),
    mod({ slug: 'deadly', type: 'untyped', modifier: 6, critical: true })
  ]

  it('excludes a crit-only modifier from ordinary damage', () => {
    const { effectiveTotal } = useModifierOverrides(ref(deadly()))
    expect(effectiveTotal.value).toBe(4)
  })

  it('includes it once the panel is showing a critical', () => {
    const { effectiveTotal } = useModifierOverrides(ref(deadly()), ref(true))
    expect(effectiveTotal.value).toBe(10)
  })

  it('measures the delta against the same context, not against zero', () => {
    const modifiers = deadly()
    const { toggleModifier, overrideDelta } = useModifierOverrides(ref(modifiers), ref(true))
    expect(overrideDelta.value).toBe(0)
    // Switching the deadly dice OFF in a critical context is worth -6, not -10:
    // the baseline is the critical reading, which already counted them.
    toggleModifier(modifiers[1])
    expect(overrideDelta.value).toBe(-6)
  })
})

// A row whose predicate names the option it waits on is switched on by DECLARING
// that option and letting PF2e answer its own predicate, rather than by
// overriding `enabled` on a slug the app may have reconstructed differently.
describe('rows PF2e is fed rather than overridden', () => {
  const steal = () => [
    mod({ slug: 'thievery', type: 'ability', modifier: 5 }),
    mod({
      slug: 'pocketed',
      type: 'circumstance',
      modifier: -2,
      enabled: false,
      ignored: true,
      enableOptions: ['action:steal:pocketed']
    })
  ]

  it('declares nothing while the row is off', () => {
    const { enabledOptions, overridePayload } = useModifierOverrides(ref(steal()))
    expect(enabledOptions()).toEqual([])
    expect(overridePayload()).toBeUndefined()
  })

  it('declares the option when the row is switched on', () => {
    const modifiers = steal()
    const { toggleModifier, enabledOptions } = useModifierOverrides(ref(modifiers))
    toggleModifier(modifiers[1])
    expect(enabledOptions()).toEqual(['action:steal:pocketed'])
  })

  it('sends the override as well, so the toggle works either way', () => {
    // Both channels push the same direction. The option makes it work when the
    // slug does not bind; the override makes it work on a roll path that cannot
    // carry options.
    const modifiers = steal()
    const { toggleModifier, overridePayload } = useModifierOverrides(ref(modifiers))
    toggleModifier(modifiers[1])
    expect(overridePayload()).toEqual({ pocketed: true })
  })

  it('declares an already-satisfied condition without being asked', () => {
    // A `fromAction` modifier PF2e already resolved as applying: the option has
    // to be replayed or the live roll loses a bonus the preview showed.
    const modifiers = [
      mod({
        slug: 'pocketed',
        type: 'circumstance',
        modifier: -2,
        enabled: true,
        enableOptions: ['action:steal:pocketed']
      })
    ]
    const { enabledOptions } = useModifierOverrides(ref(modifiers))
    expect(enabledOptions()).toEqual(['action:steal:pocketed'])
  })
})

describe('what the roll button quotes', () => {
  it('is zero delta until something is toggled', () => {
    const { overrideDelta } = useModifierOverrides(
      ref([mod({ slug: 'a', type: 'status', modifier: 2 })])
    )
    expect(overrideDelta.value).toBe(0)
  })

  it('reports what a toggle is worth, not what the list adds up to', () => {
    // The distinction that lets a caller anchor on PF2e's own total: the delta
    // survives any systematic gap between this simulation and the system's.
    const modifiers = [
      mod({ slug: 'a', type: 'status', modifier: 2 }),
      mod({ slug: 'b', type: 'circumstance', modifier: 1 })
    ]
    const { toggleModifier, overrideDelta, effectiveTotal } = useModifierOverrides(ref(modifiers))
    toggleModifier(modifiers[1])
    expect(effectiveTotal.value).toBe(2)
    expect(overrideDelta.value).toBe(-1)
  })

  it('ignores a row with no slug, which cannot be toggled at all', () => {
    const modifiers = [mod({ slug: undefined, type: 'status', modifier: 2 })]
    const { toggleModifier, overridePayload } = useModifierOverrides(ref(modifiers))
    toggleModifier(modifiers[0])
    expect(overridePayload()).toBeUndefined()
  })
})
