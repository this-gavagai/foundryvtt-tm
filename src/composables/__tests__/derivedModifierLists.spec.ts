// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  deriveArmorClass,
  deriveHitPointsMax,
  type DerivationInput
} from '@/utils/ruleEngine/statistics'
import { useDerivedModifiers } from '@/composables/character/derivedModifiers'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'

// PF2e sends a modifier list beside AC and hit points, and the sheet shows it in
// the stat modal. The engine used to fold every part of both figures into an
// opaque constant, so without a GM the modal was empty even though the number
// beside it was right.
//
// The target shape is not invented: it is what a live level-5 wizard's payload
// carries — AC `dex`/`proficiency`/`explorers-clothing`, hit points
// `ancestry-hp`/`class-hp`/`hp-con`.

const STAMP = 'pf2e@8.4.1|en|1.4.0'

const wizard = (extra: EngineItem[] = []): DerivationInput => ({
  level: 5,
  attributes: { str: 0, dex: 3, con: 3, int: 4, wis: 2, cha: 0 },
  traits: ['human'],
  stamp: STAMP,
  items: [
    {
      name: 'Human',
      type: 'ancestry',
      system: { slug: 'human', rules: [], speed: 25, hp: 8, size: 'med', traits: { value: [] } }
    } as unknown as EngineItem,
    {
      name: 'Wizard',
      type: 'class',
      system: {
        slug: 'wizard',
        rules: [],
        savingThrows: { fortitude: 1, reflex: 1, will: 2 },
        defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
        perception: 1,
        hp: 6
      } as unknown as EngineItem['system']
    },
    ...extra
  ]
})

const clothing = {
  name: "Explorer's Clothing",
  type: 'armor',
  system: {
    slug: 'explorers-clothing',
    baseItem: 'explorers-clothing',
    rules: [],
    category: 'unarmored',
    acBonus: 0,
    dexCap: 5,
    traits: { value: ['comfort'] },
    equipped: { carryType: 'worn', inSlot: true }
  }
} as unknown as EngineItem

describe('the derived modifier lists match the shape PF2e sends', () => {
  it('splits hit points into ancestry, class and constitution', () => {
    const hp = deriveHitPointsMax(wizard())
    expect(hp.value).toBe(53)
    expect(hp.modifiers.map((m) => [m.slug, m.modifier, m.type])).toEqual([
      ['ancestry-hp', 8, 'untyped'],
      ['class-hp', 30, 'untyped'],
      ['hp-con', 15, 'ability']
    ])
    // The split must be exactly the total — this is a presentation change, not
    // an arithmetic one.
    expect(hp.modifiers.reduce((sum, m) => sum + m.modifier, 0)).toBe(hp.value)
  })

  it('reports AC as attribute, proficiency and the worn armour', () => {
    const ac = deriveArmorClass(wizard([clothing]))
    expect(ac.value).toBe(20)
    expect(ac.modifiers.map((m) => [m.slug, m.modifier, m.type])).toEqual([
      ['dex', 3, 'ability'],
      ['proficiency', 7, 'proficiency'],
      ['explorers-clothing', 0, 'item']
    ])
    // 10 is the only constant left.
    expect(10 + ac.modifiers.reduce((sum, m) => sum + m.modifier, 0)).toBe(ac.value)
  })

  it('names the proficiency row by rank, as PF2e does', () => {
    // Trained at level 5 is +7, and PF2e labels the row "Trained" rather than
    // "Proficiency".
    const ac = deriveArmorClass(wizard([clothing]))
    expect(ac.modifiers.find((m) => m.slug === 'proficiency')?.label).toBe('trained')
  })

  it('emits no armour row when nothing is worn', () => {
    const ac = deriveArmorClass(wizard())
    expect(ac.modifiers.some((m) => m.type === 'item')).toBe(false)
    expect(ac.value).toBe(20)
  })

  it('folds a potency rune into the armour row rather than beside it', () => {
    // PF2e adds the rune to `acBonus` at prepare time, so it contests as ONE
    // item bonus. Two separate item entries would have contested with each
    // other and only the larger would have counted.
    const plate = {
      ...clothing,
      name: 'Half Plate',
      system: {
        ...(clothing.system as object),
        slug: 'half-plate',
        baseItem: 'half-plate',
        category: 'unarmored',
        acBonus: 5,
        runes: { potency: 2 }
      }
    } as unknown as EngineItem
    const ac = deriveArmorClass(wizard([plate]))
    const item = ac.modifiers.filter((m) => m.type === 'item')
    expect(item).toHaveLength(1)
    expect(item[0].modifier).toBe(7)
  })
})

describe('presenting them', () => {
  const { present } = useDerivedModifiers()

  it('localizes the rows the engine builds and leaves item names alone', () => {
    const rows = present(deriveArmorClass(wizard([clothing])).modifiers)
    expect(rows?.map((r) => r.label)).toEqual(['Dexterity', 'Trained', "Explorer's Clothing"])
  })

  it('names the hit point rows', () => {
    const rows = present(deriveHitPointsMax(wizard()).modifiers)
    expect(rows?.map((r) => r.label)).toEqual(['Ancestry HP', 'Class HP', 'Constitution'])
  })

  it('passes an unknown slug’s label through unchanged', () => {
    const rows = present([
      {
        slug: 'ring-of-armor',
        label: 'Ring of Armor',
        modifier: 1,
        type: 'item',
        enabled: true,
        hideIfDisabled: false,
        force: false,
        source: ''
      }
    ])
    expect(rows?.[0].label).toBe('Ring of Armor')
  })

  it('gives nothing for nothing', () => {
    expect(present(undefined)).toBeUndefined()
  })
})

// The claim the "Local · provisional" chip makes: with no payload list at all,
// the sheet still shows a breakdown. Driven through the composable rather than
// the engine, because the engine having the rows proves nothing about whether
// anything asks for them.
describe('the hit point fallback reaches the sheet', () => {
  it('presents the derived rows when the payload carries no list', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useCharacterResources } = await import('@/composables/character/characterResources')
    const { ref } = await import('vue')

    const actor = ref({
      _id: 'x',
      items: wizard().items,
      system: {
        details: { level: { value: 5 } },
        abilities: { str: {}, dex: {}, con: { mod: 3 }, int: {}, wis: {}, cha: {} },
        // No max, and crucially no `_modifiers` either: the world-dump shape.
        attributes: { hp: { value: 53, temp: 0 } }
      }
    })

    const { hp } = useCharacterResources(actor as never)
    expect(hp.modifiers.value?.map((m) => `${m.label} ${m.modifier}`)).toEqual([
      'Ancestry HP 8',
      'Class HP 30',
      'Constitution 15'
    ])
  })

  it('prefers PF2e’s own list, under either spelling', async () => {
    const { setActivePinia, createPinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useCharacterResources } = await import('@/composables/character/characterResources')
    const { ref } = await import('vue')

    const withUnderscore = ref({
      _id: 'x',
      items: wizard().items,
      system: {
        details: { level: { value: 5 } },
        abilities: { con: { mod: 3 } },
        attributes: {
          hp: { value: 53, max: 53, _modifiers: [{ slug: 'gm', label: 'From PF2e', modifier: 1 }] }
        }
      }
    })
    expect(useCharacterResources(withUnderscore as never).hp.modifiers.value?.[0].label).toBe(
      'From PF2e'
    )
  })
})

// Initiative and the spellcasting check breakdown were the last two lists the
// engine built and nothing read. Both are rendered — the combat bar and three
// spell modals — so an empty list without a GM was a visible gap, not a dead
// field. Shapes here are taken from a live payload: initiative reports
// `wis`/`Wisdom` and `proficiency`/`Trained`, spell attack `int`/`Intelligence`.
describe('the last two modifier lists', () => {
  const { present } = useDerivedModifiers()

  it('presents initiative as the statistic it follows', async () => {
    const { deriveInitiative } = await import('@/utils/ruleEngine/statistics')
    const rows = present(deriveInitiative(wizard(), 'perception', 0).modifiers)
    expect(rows?.map((r) => [r.slug, r.label])).toEqual([
      ['wis', 'Wisdom'],
      ['proficiency', 'Trained']
    ])
  })

  it('follows a named skill rather than perception when one is set', async () => {
    const { deriveInitiative } = await import('@/utils/ruleEngine/statistics')
    const rows = present(deriveInitiative(wizard(), 'stealth', 1).modifiers)
    expect(rows?.map((r) => r.label)).toEqual(['Dexterity', 'Trained'])
  })

  it('presents a spellcasting entry’s check breakdown from its own attribute', async () => {
    const { deriveSpellAttack } = await import('@/utils/ruleEngine/statistics')
    const entry = {
      name: 'Arcane Spellcasting',
      type: 'spellcastingEntry',
      system: {
        slug: 'arcane-spellcasting',
        rules: [],
        ability: { value: 'int' },
        tradition: { value: 'arcane' },
        proficiency: { value: 1 }
      }
    } as unknown as EngineItem
    const rows = present(deriveSpellAttack(wizard([entry]), entry).modifiers)
    expect(rows?.map((r) => [r.label, r.modifier])).toEqual([
      ['Intelligence', 4],
      ['Trained', 7]
    ])
  })
})
