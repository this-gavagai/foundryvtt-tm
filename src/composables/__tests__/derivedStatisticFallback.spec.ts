// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { TablemateCharacter } from '@/types/character-types'

vi.mock('@/api/actionRpc', () => ({ rollCheck: vi.fn() }))

// Count engine entries so "did it run at all" is testable, not just "was the
// answer right". The derivation is only cheap when it does not happen.
const { engineCalls } = vi.hoisted(() => ({ engineCalls: { count: 0 } }))
vi.mock('@/utils/ruleEngine/statistics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/ruleEngine/statistics')>()
  const counted =
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) => {
      engineCalls.count++
      return fn(...args)
    }
  return {
    ...actual,
    deriveSkill: counted(actual.deriveSkill),
    deriveSave: counted(actual.deriveSave),
    derivePerception: counted(actual.derivePerception),
    deriveArmorClass: counted(actual.deriveArmorClass)
  }
})
vi.mock('@/api/documents', () => ({ updateActorItem: vi.fn(), updateActor: vi.fn() }))

const { useCharacterStats } = await import('@/composables/character/characterStats')
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'

// The canonical rule, pinned: a figure PF2e supplied always wins. The engine
// exists for the sheet no GM has answered for, and the moment it starts
// overriding the system's own arithmetic it stops being a fallback and becomes a
// fork.

const STAMP = 'pf2e@8.4.1|en|1.4.0'

function character(
  system: Record<string, unknown>,
  extraItems: unknown[] = []
): Ref<TablemateCharacter | undefined> {
  return ref({
    _id: 'seelah',
    activeRules: [],
    items: [
      {
        name: 'Fighter',
        type: 'class',
        system: {
          slug: 'fighter',
          rules: [],
          savingThrows: { fortitude: 2, reflex: 2, will: 1 },
          defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
          perception: 2,
          hp: 10
        }
      },
      ...extraItems
    ],
    system: {
      details: { level: { value: 8 } },
      abilities: {
        str: { mod: 4 },
        dex: { mod: 2 },
        con: { mod: 3 },
        int: { mod: 0 },
        wis: { mod: 1 },
        cha: { mod: 0 }
      },
      ...system
    }
  }) as unknown as Ref<TablemateCharacter | undefined>
}

beforeEach(() => {
  setActivePinia(createPinia())
  useLabelCatalogsStore().$patch({ stamp: STAMP })
})

describe('cost when PF2e has answered', () => {
  // The fallback used to be passed by VALUE, so it was evaluated as an argument
  // before anything could decide it was unnecessary — every skill, save and
  // defence derived in full and discarded on each render, measured at 4.2ms per
  // sheet for a 100-item character on hardware quicker than the target tablet.
  it('does not run the engine for a figure the payload supplied', () => {
    const actor = character({
      saves: {
        fortitude: { slug: 'fortitude', label: 'Fortitude', value: 20, totalModifier: 20 },
        reflex: { slug: 'reflex', label: 'Reflex', value: 20, totalModifier: 20 },
        will: { slug: 'will', label: 'Will', value: 20, totalModifier: 20 }
      },
      perception: { slug: 'perception', label: 'Perception', value: 20, totalModifier: 20 },
      skills: { athletics: { slug: 'athletics', rank: 1, value: 20, totalModifier: 20 } },
      attributes: { ac: { value: 30 } }
    })
    const { saves, perception, skills, ac } = useCharacterStats(actor)
    engineCalls.count = 0
    // Read everything a sheet would.
    void saves.fortitude.value
    void saves.reflex.value
    void saves.will.value
    void perception.value
    void skills.value
    void ac.current.value
    void ac.provisional.value
    expect(engineCalls.count).toBe(0)
  })

  it('still runs it for a figure the payload left out', () => {
    const { saves } = useCharacterStats(character({}))
    engineCalls.count = 0
    expect(saves.fortitude.value?.value).toBe(15)
    expect(engineCalls.count).toBeGreaterThan(0)
  })
})

describe('when PF2e has answered', () => {
  it('keeps the payload’s save and never substitutes its own', () => {
    // The prepared trace says 99 — a number no derivation would produce. If the
    // engine ever wins here, the fallback has become an override.
    const actor = character({
      saves: { fortitude: { slug: 'fortitude', label: 'Fortitude', value: 99, totalModifier: 99 } }
    })
    const { saves } = useCharacterStats(actor)
    expect(saves.fortitude.value?.value).toBe(99)
    expect(saves.fortitude.value?.provisional).toBeFalsy()
  })

  it('keeps the payload’s AC', () => {
    const actor = character({ attributes: { ac: { value: 99 } } })
    const { ac } = useCharacterStats(actor)
    expect(ac.current.value).toBe(99)
    expect(ac.provisional.value).toBe(false)
  })
})

describe('when no GM has answered', () => {
  it('derives the save from the class baseline, unmarked', () => {
    // Once "Reflex Expertise" and its kind were found to carry their rank in
    // `subfeatures.proficiencies`, the baseline stopped being a guess. Marking
    // it anyway put a caveat on five figures out of five, identical on each,
    // which ranks nothing — see the note in deriveProficiencyRanks.
    const actor = character({})
    const { saves } = useCharacterStats(actor)
    // Con 3 + (expert 2 x 2 + level 8) = 15
    expect(saves.fortitude.value?.value).toBe(15)
    expect(saves.fortitude.value?.provisional).toBe(false)
  })

  it('derives AC from the unarmoured proficiency', () => {
    const actor = character({})
    const { ac } = useCharacterStats(actor)
    // 10 + dex 2 + (trained 1 x 2 + 8) = 22
    expect(ac.current.value).toBe(22)
  })

  it('marks the figure provisional when the engine had a gap', () => {
    const actor = character({}, [
      {
        name: 'Conditional Guard',
        type: 'feat',
        system: {
          slug: 'conditional-guard',
          rules: [
            {
              key: 'FlatModifier',
              selector: 'ac',
              type: 'circumstance',
              value: 2,
              predicate: ['self:armored']
            }
          ]
        }
      }
    ])
    const { ac } = useCharacterStats(actor)
    expect(ac.current.value).toBe(22)
    expect(ac.provisional.value).toBe(true)
    expect(ac.caveat.value).toContain('unresolvable-predicate')
  })

  it('marks every figure provisional on an unverified system version', () => {
    setActivePinia(createPinia())
    useLabelCatalogsStore().$patch({ stamp: 'pf2e@9.0.0|en|1.0.0' })
    const { ac } = useCharacterStats(character({}))
    expect(ac.provisional.value).toBe(true)
  })
})
