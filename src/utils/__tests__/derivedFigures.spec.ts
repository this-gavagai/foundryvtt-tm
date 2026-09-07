// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { derivableFigures } from '@/utils/derivedFigures'
import type { TablemateCharacter } from '@/types/character-types'
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'

// The figure table itself, rather than the rule that consumes it.
//
// The rule has its own spec, and it passed throughout — because that spec stubs
// the figure list out. So nothing tested what a figure actually reads, and six
// of them read the payload in a shape their own answer is never expressed in.
// Every one reported a miss on every payload with the numbers in agreement:
//
//   ac              our 21 against PF2e's `totalModifier` (11) instead of its
//                   `value` (21) — the same AC without its base 10
//   inventory.bulk  our "4.4|10|5" against a payload OBJECT
//   inventory.*     our Bulk instances against PF2e's capacity records, our
//                   label map over every item against the payload's physical
//                   ones, our prices missing the zero denominations PF2e fills
//   movement        our "land:25|…" against a payload object
//   iwr             a derived list against the STORED list it was derived from
//
// So this pins the payload side: shapes copied from a real payload (Yoon, level
// 5), and each figure asked what it reads out of them.

// PF2e's real shapes, trimmed to the fields the figures touch. The doubled
// numbers are the point of the fixture rather than noise in it: `ac.value` is
// 21 and `ac.totalModifier` is 11, and only one of them is the AC.
function character(): TablemateCharacter {
  return {
    _id: 'yoon',
    name: 'Yoon',
    type: 'character',
    items: [
      {
        _id: 'pack',
        name: 'Backpack',
        type: 'backpack',
        system: { bulk: { capacity: 4, ignored: 2, value: 1 }, quantity: 1, equipped: {} }
      },
      {
        _id: 'dagger',
        name: 'Dagger',
        type: 'weapon',
        system: { baseItem: 'dagger', bulk: { value: 1 }, quantity: 1, equipped: {} }
      },
      // Not an inventory type: the payload does not name it, so neither do we.
      { _id: 'feat', name: 'Incredible Initiative', type: 'feat', system: {} }
    ],
    inventory: {
      bulk: {
        max: 10,
        bulk: 0,
        encumberedAfter: 5,
        value: { value: 0.9, light: 9, normal: 0 }
      },
      containers: { pack: { value: 1.1, max: 4, percentFull: 27, ignored: 2, ignoredMax: 2 } },
      labels: { pack: 'Backpack', dagger: '+1 Dagger', feat: 'Incredible Initiative' }
    },
    system: {
      details: { level: { value: 5 } },
      abilities: { str: { mod: 0 }, dex: { mod: 4 }, con: { mod: 4 } },
      attributes: {
        ac: { slug: 'ac', value: 21, totalModifier: 11, dc: 21, modifiers: [] },
        hp: { value: 5, max: 68, totalModifier: 68 },
        immunities: [],
        weaknesses: [],
        resistances: []
      },
      perception: { slug: 'perception', value: 7, totalModifier: 7, dc: 17 },
      saves: { fortitude: { slug: 'fortitude', value: 13, totalModifier: 13, dc: 23 } },
      skills: { acrobatics: { slug: 'acrobatics', value: 11, totalModifier: 11, dc: 21, rank: 1 } },
      initiative: { slug: 'initiative', value: 9, totalModifier: 9, statistic: 'perception' },
      resources: { focus: { value: 0, max: 0, cap: 3 } },
      movement: {
        speeds: {
          land: { type: 'land', value: 25, base: 25, breakdown: '25-Foot Land Speed' },
          travel: { type: 'travel', value: 25 }
        }
      }
    }
  } as unknown as TablemateCharacter
}

const table = () => {
  // Vue's UnwrapRef recurses through the PF2e document types these wire shapes
  // claim, so the ref is built untyped and cast once rather than the fixture
  // being cast field by field.
  const actor = ref<TablemateCharacter | undefined>() as Ref<TablemateCharacter | undefined>
  actor.value = character()
  const figures = derivableFigures(actor, undefined)
  return { actor, figures, by: (key: string) => figures.find((f) => f.key === key) }
}

describe('what each figure reads out of a payload', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('takes AC from `value`, not from the `totalModifier` beside it', () => {
    // The whole bug in one assertion. Both numbers are AC; only one is the AC.
    expect(table().by('ac')?.reported()).toBe(21)
  })

  it('reads a statistic as its total rather than as the object holding it', () => {
    const { by } = table()
    expect(by('perception')?.reported()).toBe(7)
    expect(by('save.fortitude')?.reported()).toBe(13)
    expect(by('skill.acrobatics')?.reported()).toBe(11)
    expect(by('hp.max')?.reported()).toBe(68)
    expect(by('initiative')?.reported()).toBe(9)
    expect(by('focus.max')?.reported()).toBe(0)
  })

  it('renders the payload bulk the way it renders its own', () => {
    expect(table().by('inventory.bulk')?.reported()).toBe('0.9|10|5')
  })

  it('reduces container capacity to what is held, sorted by id', () => {
    expect(table().by('inventory.containers')?.reported()).toBe('[["pack",1.1]]')
  })

  it('renders the payload speeds the way it renders its own', () => {
    expect(table().by('movement')?.reported()).toBe('land:25|burrow:|climb:|fly:|swim:')
  })

  it('names the physical items, in our order, and only those', () => {
    // The payload also names the feat. Ours cannot, so the comparison must not
    // reach for it — a comparison across two sets of items is not a comparison.
    expect(table().by('inventory.labels')?.reported()).toBe(
      JSON.stringify([
        ['pack', 'Backpack'],
        ['dagger', '+1 Dagger']
      ])
    )
  })

  it('offers no IWR figure — the payload carries no derived list to compare', () => {
    // `system.attributes.immunities` is the STORED list, which is the seed our
    // derivation starts from. Comparing against it reported a miss for every
    // rule element that had done its job.
    expect(table().by('iwr')).toBeUndefined()
  })
})

describe('the invariant behind all of that', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // The general form, so a figure added later cannot reintroduce the bug: a
  // figure that reports an object has not said what it predicts, and whatever
  // compares the two sides is left guessing between the numbers inside it.
  it('every figure reports something directly comparable', () => {
    for (const figure of table().figures) {
      const reported = figure.reported()
      if (reported === undefined || reported === null) continue
      expect(typeof reported, `${figure.key} reports an object`).not.toBe('object')
    }
  })

  it('and states its own answer in that same form', () => {
    for (const figure of table().figures) {
      const value = figure.value()
      if (value === undefined || value === null) continue
      expect(typeof value, `${figure.key} answers with an object`).not.toBe('object')
    }
  })
})

describe('clearing a figure', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // AC reads `value` but clears the whole `ac` object: a breakdown that outlived
  // the total it explains would be worse than no breakdown.
  it('drops the whole statistic, not just the number it read', () => {
    const { actor, by } = table()
    by('ac')?.clear()
    expect(actor.value?.system?.attributes?.ac).toBeUndefined()
  })

  it('leaves the statistic’s siblings alone', () => {
    const { actor, by } = table()
    by('ac')?.clear()
    expect(actor.value?.system?.attributes?.hp?.max).toBe(68)
  })
})

// Without the world's rune and material names, composeItemName hands back the
// item's stored name — which is not our answer, it is the absence of one. The
// figure has to decline, or it predicts "Dagger" against PF2e's "+2 Greater
// Striking Dagger" on every payload for as long as the catalog is unpublished.
describe('the label figure without its catalog', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('declines to answer rather than composing from nothing', () => {
    // A fresh pinia has an empty catalog, which is what an unpublished one
    // looks like: the module publishes the whole system's names or none.
    expect(table().by('inventory.labels')?.value()).toBeUndefined()
  })

  it('answers once the catalog is there', () => {
    useLabelCatalogsStore().catalogs.itemNames = { 'weapon-base-dagger': 'Dagger' }
    expect(table().by('inventory.labels')?.value()).toBe(
      JSON.stringify([
        ['pack', 'Backpack'],
        ['dagger', 'Dagger']
      ])
    )
  })
})
