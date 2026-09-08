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
    // Names the item, in words a player has a chance with — see describeLedger.
    expect(ac.caveat.value).toContain('Conditional Guard')
  })

  it('marks every figure provisional on an unverified system version', () => {
    setActivePinia(createPinia())
    useLabelCatalogsStore().$patch({ stamp: 'pf2e@9.0.0|en|1.0.0' })
    const { ac } = useCharacterStats(character({}))
    expect(ac.provisional.value).toBe(true)
  })
})

// The sheet colours a statistic by its rank (StatBox's data-proficiency-level),
// so a derived figure that reports no rank is not merely uncoloured — it is
// coloured WRONG, in the neutral grey that means untrained. The number and its
// hue have to come from the same place.
describe('the rank behind a derived figure', () => {
  it('reports the class rank for a save the payload never carried', () => {
    const { saves } = useCharacterStats(character({}))
    // Fighter fortitude is expert, and the figure already spends that rank on
    // its proficiency bonus — it just never said so.
    expect(saves.fortitude.value?.rank).toBe(2)
  })

  it('reports the class rank for a perception the payload never carried', () => {
    const { perception } = useCharacterStats(character({}))
    expect(perception.value?.rank).toBe(2)
  })

  it('overrides the stale zero a world dump stores beside the stale value', () => {
    // The exact shape two of the ten test-table characters carry: a rank and a
    // value PF2e overwrites during preparation and never reads. `looksPrepared`
    // already rejects the value; the rank rode along with it and painted an
    // expert save untrained.
    const actor = character({ saves: { fortitude: { rank: 0, value: 0 } } })
    const { saves } = useCharacterStats(actor)
    expect(saves.fortitude.value?.value).toBe(15)
    expect(saves.fortitude.value?.rank).toBe(2)
  })

  it('reports a rank an AE-like upgrade raised above the stored one', () => {
    const actor = character({ skills: { athletics: { slug: 'athletics', rank: 1 } } }, [
      {
        name: 'Juggernaut',
        type: 'feat',
        system: {
          slug: 'juggernaut',
          rules: [
            {
              key: 'ActiveEffectLike',
              mode: 'upgrade',
              path: 'system.skills.athletics.rank',
              value: 3
            }
          ]
        }
      }
    ])
    const { skills } = useCharacterStats(actor)
    const athletics = skills.value?.find((skill) => skill.slug === 'athletics')
    // str 4 + (master 3 x 2 + 8) = 18, and the hue has to agree with the total.
    expect(athletics?.value).toBe(18)
    expect(athletics?.rank).toBe(3)
  })

  it('reports a lore’s rank from its own item', () => {
    const actor = character({}, [
      { name: 'Warfare Lore', type: 'lore', system: { proficient: { value: 2 } } }
    ])
    const { skills } = useCharacterStats(actor)
    expect(skills.value?.find((skill) => skill.lore)?.rank).toBe(2)
  })

  it('leaves the payload’s own rank alone on a prepared statistic', () => {
    // The prepared branch returns PF2e's trace untouched, engine and all. A
    // rank the system prepared outranks anything derived here.
    const actor = character({
      saves: { fortitude: { slug: 'fortitude', rank: 4, value: 20, totalModifier: 20 } }
    })
    const { saves } = useCharacterStats(actor)
    expect(saves.fortitude.value?.rank).toBe(4)
  })
})
