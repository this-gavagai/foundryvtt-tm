// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// One rule for every derived value: trust the payload until our own calculation
// says the world moved, then drop the payload's copy until a fresh one lands.
//
// The figure list is stubbed so these test the RULE rather than any particular
// derivation — the rule is the thing that has to hold for all of them.
const { figures } = vi.hoisted(() => ({ figures: { current: [] as unknown[] } }))
vi.mock('@/utils/derivedFigures', () => ({
  derivableFigures: () => figures.current
}))

import { reconcileDerived, checkPredictions, forgetPredictions } from '@/utils/derivedReconcile'

// A figure whose calculated value the test controls, and which records whether
// its payload copy was dropped.
function figure(key: string, value: () => unknown, reported: () => unknown = () => undefined) {
  return {
    key,
    value,
    reported,
    cleared: 0,
    clear() {
      this.cleared++
    }
  }
}

const actor = ref({ _id: 'a1' }) as never

describe('the one rule', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    forgetPredictions()
  })

  it('drops nothing on the first pass — the payload is still the best answer', () => {
    const bulk = figure('bulk', () => 3)
    figures.current = [bulk]
    expect(reconcileDerived('a1', actor, undefined)).toEqual([])
    expect(bulk.cleared).toBe(0)
  })

  it('drops the payload for a figure whose calculation moved', () => {
    let carried = 3
    const bulk = figure('bulk', () => carried)
    figures.current = [bulk]
    reconcileDerived('a1', actor, undefined)
    carried = 5
    expect(reconcileDerived('a1', actor, undefined)).toEqual(['bulk'])
    expect(bulk.cleared).toBe(1)
  })

  // The reason no dependency map is needed: a write that does not affect a
  // figure leaves its calculation where it was, so the payload's copy survives.
  it('leaves a figure whose calculation did not move', () => {
    const ac = figure('ac', () => 20)
    const bulk = figure('bulk', () => 3)
    figures.current = [ac, bulk]
    reconcileDerived('a1', actor, undefined)
    reconcileDerived('a1', actor, undefined)
    expect(ac.cleared).toBe(0)
    expect(bulk.cleared).toBe(0)
  })

  it('keeps one actor’s predictions away from another’s', () => {
    let value = 1
    figures.current = [figure('bulk', () => value)]
    reconcileDerived('a1', actor, undefined)
    value = 2
    // b1 has never been reconciled, so this is ITS first pass: nothing drops.
    expect(reconcileDerived('b1', actor, undefined)).toEqual([])
  })

  it('survives a derivation that throws, and still reconciles the rest', () => {
    let carried = 3
    const bad = figure('bad', () => {
      throw new Error('nope')
    })
    const bulk = figure('bulk', () => carried)
    figures.current = [bad, bulk]
    reconcileDerived('a1', actor, undefined)
    carried = 9
    expect(reconcileDerived('a1', actor, undefined)).toEqual(['bulk'])
  })
})

describe('the prediction it leaves behind', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    forgetPredictions()
  })

  it('reports nothing when PF2e agrees with what we said', () => {
    figures.current = [
      figure(
        'ac',
        () => 22,
        () => 22
      )
    ]
    reconcileDerived('a1', actor, undefined)
    expect(checkPredictions('a1', actor, undefined)).toEqual([])
  })

  // The whole point: a derivation can be right at rest and wrong the moment
  // armour is equipped, and only a prediction across the mutation notices.
  it('reports a miss when it does not', () => {
    figures.current = [
      figure(
        'ac',
        () => 22,
        () => ({ value: 25 })
      )
    ]
    reconcileDerived('a1', actor, undefined)
    const misses = checkPredictions('a1', actor, undefined)
    expect(misses).toHaveLength(1)
    expect(misses[0].key).toBe('ac')
  })

  // This used to assert the opposite: that the rule would dig the total out of
  // whatever object a figure handed it, taking the first number among
  // `totalModifier`, `value`, `max`, `dc`. That guess cannot be made from a key
  // name — PF2e's AC object carries `value: 21` AND `totalModifier: 11`, the same
  // AC with and without its base 10 — and it silently took the wrong one, so AC
  // reported a miss on every payload with the numbers in agreement. Making the
  // two sides meet is the FIGURE's job now, and has its own spec.
  it('compares what the figure hands it, without looking inside', () => {
    figures.current = [
      figure(
        'perception',
        () => 9,
        () => ({ totalModifier: 9 })
      )
    ]
    reconcileDerived('a1', actor, undefined)
    expect(checkPredictions('a1', actor, undefined)).toEqual([
      { key: 'perception', predicted: 9, reported: { totalModifier: 9 } }
    ])
  })

  it('is not a miss when the payload reports nothing for that figure', () => {
    figures.current = [
      figure(
        'ac',
        () => 22,
        () => undefined
      )
    ]
    reconcileDerived('a1', actor, undefined)
    expect(checkPredictions('a1', actor, undefined)).toEqual([])
  })

  // A prediction belongs to the write that produced it and to the FIRST payload
  // after it. Holding it longer would compare it against a world it never
  // described.
  it('is spent once checked', () => {
    figures.current = [
      figure(
        'ac',
        () => 22,
        () => ({ value: 25 })
      )
    ]
    reconcileDerived('a1', actor, undefined)
    expect(checkPredictions('a1', actor, undefined)).toHaveLength(1)
    expect(checkPredictions('a1', actor, undefined)).toEqual([])
  })

  it('has nothing to say when no write has happened', () => {
    figures.current = [
      figure(
        'ac',
        () => 22,
        () => ({ value: 25 })
      )
    ]
    expect(checkPredictions('a1', actor, undefined)).toEqual([])
  })
})
