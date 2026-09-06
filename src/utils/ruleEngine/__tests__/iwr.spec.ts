import { describe, it, expect } from 'vitest'
import { deriveIWR, type DerivationInput } from '@/utils/ruleEngine/statistics'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'

const STAMP = 'pf2e@8.4.1|en|1.4.0'

const feature = (name: string, rules: unknown[]): EngineItem => ({
  name,
  type: 'feat',
  system: { slug: name.toLowerCase().replace(/ /g, '-'), rules }
})

const character = (items: EngineItem[] = [], level = 5): DerivationInput => ({
  level,
  attributes: { str: 0, dex: 2, con: 3, int: 0, wis: 1, cha: 0 },
  traits: ['dwarf'],
  stamp: STAMP,
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
      } as unknown as EngineItem['system']
    },
    ...items
  ]
})

// Shapes taken from the live table rather than invented: Charhide Goblin and
// Strong-Blooded Dwarf both grant `max(1,floor(@actor.level/2))`.
const charhide = feature('Charhide Goblin', [
  { key: 'Resistance', type: 'fire', value: 'max(1,floor(@actor.level/2))' }
])

describe('IWR from rule elements', () => {
  it('resolves a level-scaled resistance', () => {
    // Level 5 → max(1, floor(5/2)) = 2
    const iwr = deriveIWR(character([charhide]))
    expect(iwr.resistances).toEqual([
      expect.objectContaining({ type: 'fire', value: 2, source: 'Charhide Goblin' })
    ])
  })

  it('takes a single type string as one entry', () => {
    // PF2e's schema is an array field; source data carries both spellings.
    const one = deriveIWR(character([feature('A', [{ key: 'Immunity', type: 'poison' }])]))
    expect(one.immunities.map((e) => e.type)).toEqual(['poison'])
  })

  it('expands a type array into one entry each', () => {
    const many = deriveIWR(
      character([feature('Fire Gate', [{ key: 'Resistance', type: ['cold', 'fire'], value: 5 }])])
    )
    expect(many.resistances.map((e) => e.type)).toEqual(['cold', 'fire'])
  })

  it('drops a resistance that resolves to zero rather than showing it', () => {
    // A level 1 character: floor(1/2) is 0, and PF2e returns no entry at all.
    const iwr = deriveIWR(
      character(
        [feature('Seer', [{ key: 'Resistance', type: 'void', value: 'floor(@actor.level/2)' }])],
        1
      )
    )
    expect(iwr.resistances).toEqual([])
  })

  it('seeds from the actor’s authored entries', () => {
    const stored = { weaknesses: [{ type: 'cold', value: 5, exceptions: [] }] }
    const iwr = deriveIWR(character(), stored)
    expect(iwr.weaknesses).toEqual([expect.objectContaining({ type: 'cold', value: 5 })])
  })

  // THE property the single code path rests on. PF2e keeps the higher value for
  // a type already present, so folding the rules into a list that already has
  // them is a no-op — which is why this can run on a prepared payload as safely
  // as on a world dump, without a "which path am I on" test.
  it('is idempotent against an already-prepared list', () => {
    const once = deriveIWR(character([charhide]))
    const twice = deriveIWR(character([charhide]), { resistances: once.resistances })
    expect(twice.resistances).toEqual(once.resistances)
  })

  it('keeps the higher value when two rules grant the same type', () => {
    const items = [
      feature('Weak', [{ key: 'Resistance', type: 'fire', value: 2 }]),
      feature('Strong', [{ key: 'Resistance', type: 'fire', value: 7 }])
    ]
    expect(deriveIWR(character(items)).resistances).toEqual([
      expect.objectContaining({ type: 'fire', value: 7 })
    ])
  })

  it('replaces rather than maximises when the rule says override', () => {
    const items = [
      feature('Strong', [{ key: 'Resistance', type: 'fire', value: 7 }]),
      feature('Capped', [{ key: 'Resistance', type: 'fire', value: 3, override: true }])
    ]
    expect(deriveIWR(character(items)).resistances).toEqual([
      expect.objectContaining({ type: 'fire', value: 3 })
    ])
  })

  it('removes a type when the rule says so', () => {
    const items = [feature('Cured', [{ key: 'Weakness', type: 'cold', mode: 'remove' }])]
    const iwr = deriveIWR(character(items), { weaknesses: [{ type: 'cold', value: 5 }] })
    expect(iwr.weaknesses).toEqual([])
  })

  it('labels a custom type from the granting rule, since its slug means nothing', () => {
    const items = [
      feature('Amulet', [
        { key: 'Resistance', type: 'custom', value: 5, label: 'Channel Protection Amulet' }
      ])
    ]
    expect(deriveIWR(character(items)).resistances[0].customLabel).toBe('Channel Protection Amulet')
  })

  it('records an unresolvable predicate rather than adding or dropping silently', () => {
    const items = [
      feature('Maybe', [
        { key: 'Resistance', type: 'fire', value: 5, predicate: ['weather:storm'] }
      ])
    ]
    const iwr = deriveIWR(character(items))
    expect(iwr.resistances).toEqual([])
    expect(iwr.ledger.skipped).toHaveLength(1)
    expect(iwr.ledger.confidence).not.toBe('exact')
  })

  it('skips a rule whose predicate is definitely false, with nothing recorded', () => {
    const items = [
      feature('Aiding', [{ key: 'Resistance', type: 'fire', value: 5, predicate: ['action:aid'] }])
    ]
    const iwr = deriveIWR(character(items))
    expect(iwr.resistances).toEqual([])
    expect(iwr.ledger.skipped).toHaveLength(0)
  })
})
