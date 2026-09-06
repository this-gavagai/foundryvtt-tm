// @vitest-environment jsdom
// The composables reach the i18n plugin and the label store at module load.
import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import type { TablemateCharacter } from '@/types/character-types'
import { useDerivedStatistics } from '@/composables/character/derivedStatistics'

// The fallback path itself, not the arithmetic behind it.
//
// The engine agreeing with PF2e is measured by the differential harness. What
// that cannot see is whether the SHEET ever asks: a derivation wired to a field
// the payload always fills is dead code that measures perfectly. Movement is the
// clearest case — a world dump carries no `system.movement` at all, so the whole
// panel is either the engine's or blank.

const character = (over: Record<string, unknown> = {}) =>
  ref({
    _id: 'test',
    items: [
      {
        name: 'Dwarf',
        type: 'ancestry',
        system: { slug: 'dwarf', rules: [], speed: 20, size: 'med', traits: { value: ['dwarf'] } }
      },
      {
        name: 'Cleric',
        type: 'class',
        system: {
          slug: 'cleric',
          rules: [],
          savingThrows: { fortitude: 1, reflex: 1, will: 2 },
          defenses: { unarmored: 1, light: 1, medium: 1, heavy: 0 },
          perception: 1,
          hp: 8
        }
      },
      {
        name: 'Lay on Hands',
        type: 'spell',
        system: { slug: 'lay-on-hands', rules: [], traits: { value: ['focus', 'healing'] } }
      }
    ],
    system: {
      details: { level: { value: 5 } },
      abilities: {
        str: { mod: 1 },
        dex: { mod: 2 },
        con: { mod: 3 },
        int: { mod: 0 },
        wis: { mod: 4 },
        cha: { mod: 1 }
      },
      ...over
    }
  }) as unknown as ReturnType<typeof ref<TablemateCharacter | undefined>>

describe('the movement fallback', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('derives land speed from the ancestry when the payload has no movement', () => {
    const derived = useDerivedStatistics(character())
    expect(derived.speed('land')?.value).toBe(20)
  })

  it('answers null — not undefined — for a speed the character does not have', () => {
    // The distinction the sheet acts on: null is "no fly speed", which is an
    // answer, and undefined is "nothing to say".
    expect(useDerivedStatistics(character()).speed('fly')).toBeNull()
  })

  it('derives the focus pool from the character’s focus spells', () => {
    expect(useDerivedStatistics(character()).focusPoolMax.value?.value).toBe(1)
  })

  it('gives nothing at all without a level, rather than a figure built on zero', () => {
    const noLevel = character({ details: {} })
    expect(useDerivedStatistics(noLevel).speed('land')).toBeUndefined()
    expect(useDerivedStatistics(noLevel).focusPoolMax.value).toBeUndefined()
  })
})
