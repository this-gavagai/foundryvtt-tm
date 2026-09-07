// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import type { Modifier } from '@/composables/character/defs/modifier'

// The sheet re-runs PF2e's stacking contest on every toggle, because toggling
// changes who wins and neither PF2e nor the engine knows what was toggled. That
// is a real need — but it used to be met by a SECOND implementation of the rule
// living here, and the two had drifted: this one knew nothing of `force`, split
// ability modifiers by sign where PF2e contests them as one group, and gave ties
// to the first entry where PF2e gives them to the last.
//
// It now calls the engine's `stackingOutcome`. These tests exist to keep it
// calling it — each case is one the local copy got wrong.

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
  ...over
})

const losersOf = (modifiers: Modifier[]) => {
  const { stackingLosers } = useModifierOverrides(ref(modifiers))
  return stackingLosers.value
}

describe('the contest the sheet re-runs', () => {
  it('marks the smaller of a type as outranked', () => {
    const losers = losersOf([
      mod({ slug: 'big', type: 'status', modifier: 2 }),
      mod({ slug: 'small', type: 'status', modifier: 1 })
    ])
    expect([...losers]).toEqual(['small'])
  })

  it('lets untyped modifiers all stand', () => {
    expect([
      ...losersOf([mod({ slug: 'a', modifier: 1 }), mod({ slug: 'b', modifier: 2 })])
    ]).toEqual([])
  })

  it('gives a tie to the later entry, as PF2e does', () => {
    const losers = losersOf([
      mod({ slug: 'first', type: 'item', modifier: 2 }),
      mod({ slug: 'second', type: 'item', modifier: 2 })
    ])
    expect([...losers]).toEqual(['first'])
  })

  it('contests ability modifiers as one group across both signs', () => {
    const losers = losersOf([
      mod({ slug: 'dex', type: 'ability', modifier: 4 }),
      mod({ slug: 'drained', type: 'ability', modifier: -1 })
    ])
    // Not a bonus and a penalty side by side: one survivor.
    expect([...losers]).toEqual(['drained'])
  })

  it('lets a forced ability modifier beat a larger one', () => {
    const losers = losersOf([
      mod({ slug: 'dex', type: 'ability', modifier: 4 }),
      mod({ slug: 'forced', type: 'ability', modifier: 1, force: true })
    ])
    expect([...losers]).toEqual(['dex'])
  })

  it('makes a forced modifier of any other type compete normally', () => {
    const losers = losersOf([
      mod({ slug: 'big', type: 'status', modifier: 2 }),
      mod({ slug: 'forced', type: 'status', modifier: 1, force: true })
    ])
    expect([...losers]).toEqual(['forced'])
  })

  it('keeps an ignored modifier out of the contest entirely', () => {
    // An unequipped item's modifier does not outrank anything, and is not
    // itself reported as outranked — it simply is not in play.
    const losers = losersOf([
      mod({ slug: 'worn', type: 'item', modifier: 1 }),
      mod({ slug: 'in-the-bag', type: 'item', modifier: 3, ignored: true })
    ])
    expect([...losers]).toEqual([])
  })

  it('does not call a switched-off modifier outranked', () => {
    // Greyed and struck-through mean different things to a reader: one is "you
    // turned this off", the other "something better applies".
    const losers = losersOf([
      mod({ slug: 'on', type: 'status', modifier: 2 }),
      mod({ slug: 'off', type: 'status', modifier: 1, enabled: false })
    ])
    expect([...losers]).toEqual([])
  })

  it('re-runs the contest when the player toggles one on', () => {
    const modifiers = [
      mod({ slug: 'on', type: 'status', modifier: 1 }),
      mod({ slug: 'off', type: 'status', modifier: 3, enabled: false })
    ]
    const { stackingLosers, toggleModifier } = useModifierOverrides(ref(modifiers))
    expect([...stackingLosers.value]).toEqual([])
    // Switching the bigger one on has to outrank the smaller one — the whole
    // reason this cannot be answered once on the server.
    toggleModifier(modifiers[1])
    expect([...stackingLosers.value]).toEqual(['on'])
  })
})
