// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useCharacterStats } from '@/composables/character/characterStats'
import type { TablemateCharacter } from '@/types/character-types'

// What reaches the info modal when no GM has answered for the sheet.
//
// Two failures met here, and both were invisible because the NUMBER beside the
// empty list was usually right:
//
//   1. `statOrDerived` carried the engine's total but not its modifiers, so the
//      AC modal had a breakdown and the save, skill and perception modals had
//      the right number over nothing.
//   2. Its gate was `value !== undefined`, and a world dump satisfies that. Two
//      of ten characters on the test table store `saves.fortitude` as
//      `{ rank: 0, value: 0 }` — a stale zero PF2e overwrites during
//      preparation — so their saves displayed as +0.

// A level-5 cleric, shaped like the world dump: ranks and a stale zero, no
// prepared marks anywhere.
function dumpedCharacter(saves: unknown): TablemateCharacter {
  return {
    _id: 'kyra',
    name: 'Kyra',
    type: 'character',
    items: [
      {
        _id: 'ancestry',
        name: 'Human',
        type: 'ancestry',
        system: { slug: 'human', rules: [], speed: 25, hp: 8, size: 'med', traits: { value: [] } }
      },
      {
        _id: 'class',
        name: 'Cleric',
        type: 'class',
        system: {
          slug: 'cleric',
          rules: [],
          savingThrows: { fortitude: 1, reflex: 1, will: 2 },
          defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
          perception: 1,
          hp: 8
        }
      }
    ],
    system: {
      details: { level: { value: 5 } },
      abilities: { str: { mod: 1 }, dex: { mod: 1 }, con: { mod: 2 }, wis: { mod: 4 } },
      attributes: {},
      saves,
      skills: { medicine: { rank: 2 } }
    }
  } as unknown as TablemateCharacter
}

// The ref is built empty and cast once: Vue's UnwrapRef recurses through the
// PF2e document types these wire shapes claim, and typing it inline hits the
// compiler's depth limit.
const stats = (actor: TablemateCharacter) => {
  const holder = ref<TablemateCharacter | undefined>() as Ref<TablemateCharacter | undefined>
  holder.value = actor
  return useCharacterStats(holder)
}

describe('a save the world dump left a stale zero for', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('derives it rather than believing the zero', () => {
    const save = stats(dumpedCharacter({ fortitude: { rank: 0, value: 0 } })).saves.fortitude.value
    // 2 (Con) + 2 + level 5 at trained: whatever the engine says, not 0.
    expect(save?.value).toBeGreaterThan(0)
  })

  it('shows the breakdown beside it', () => {
    const save = stats(dumpedCharacter({ fortitude: { rank: 0, value: 0 } })).saves.fortitude.value
    expect(save?.modifiers?.map((m) => m.slug)).toEqual(['con', 'proficiency'])
  })

  it('marks it as the engine’s answer', () => {
    const save = stats(dumpedCharacter({ fortitude: { rank: 0, value: 0 } })).saves.fortitude.value
    expect(save?.caveat).toBeTruthy()
  })
})

describe('a save PF2e actually prepared', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // The gate has to keep preferring the payload. `totalModifier` is one of the
  // three marks only preparation leaves; a breakdown or a modifier list is
  // enough on its own, which is how hit points qualify.
  it('is preferred over the engine, breakdown and all', () => {
    const save = stats(
      dumpedCharacter({
        fortitude: {
          rank: 2,
          value: 13,
          totalModifier: 13,
          breakdown: 'Constitution +4, Expert +9',
          modifiers: [
            { slug: 'con', label: 'Constitution', modifier: 4, type: 'ability', enabled: true }
          ]
        }
      })
    ).saves.fortitude.value
    expect(save?.value).toBe(13)
    expect(save?.modifiers?.map((m) => m.slug)).toEqual(['con'])
    // Not the engine's, so no caveat.
    expect(save?.caveat).toBeUndefined()
  })

  it('is preferred on a breakdown alone, with no totalModifier', () => {
    const save = stats(
      dumpedCharacter({
        fortitude: { rank: 2, value: 13, breakdown: 'Constitution +4, Expert +9' }
      })
    ).saves.fortitude.value
    expect(save?.value).toBe(13)
  })
})

describe('the breakdown for the other derived figures', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('reaches perception and skills, not only AC', () => {
    const s = stats(dumpedCharacter({}))
    expect(s.perception.value?.modifiers?.map((m) => m.slug)).toEqual(['wis', 'proficiency'])
    const medicine = (s.skills.value as { slug?: string; modifiers?: { slug?: string }[] }[]).find(
      (skill) => skill.slug === 'medicine'
    )
    expect(medicine?.modifiers?.map((m) => m.slug)).toEqual(['wis', 'proficiency'])
  })
})
