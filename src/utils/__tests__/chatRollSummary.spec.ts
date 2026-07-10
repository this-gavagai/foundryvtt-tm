import { describe, it, expect } from 'vitest'
import { parseRollJson, rollSummary, rollSummaries } from '@/utils/chatRollSummary'
import {
  checkRollNat1,
  damageSimple,
  damageMultiInstance,
  damageHealing,
  damageUntyped
} from './fixtures/pf2eRolls'

// rollSummary defensively traverses whatever roll JSON Foundry/PF2e serialize
// into message.rolls — the shape most likely to drift on a system update. The
// fixtures are REAL serialized rolls (see fixtures/pf2eRolls.ts), so a PF2e
// change that breaks parsing fails here with a readable diff first.

describe('parseRollJson', () => {
  it('parses a JSON string into a roll object', () => {
    expect(parseRollJson(checkRollNat1)?.class).toBe('CheckRoll')
  })

  it('passes an already-parsed object through', () => {
    const parsed = JSON.parse(checkRollNat1)
    expect(parseRollJson(parsed)).toBe(parsed)
  })

  it('returns undefined for invalid JSON, non-objects, and undefined', () => {
    expect(parseRollJson('not json')).toBeUndefined()
    expect(parseRollJson('42')).toBeUndefined()
    expect(parseRollJson(undefined)).toBeUndefined()
  })
})

describe('rollSummary — real CheckRoll (saving throw, natural 1)', () => {
  const summary = rollSummary(checkRollNat1)!

  it('extracts class, formula, and total', () => {
    expect(summary.className).toBe('CheckRoll')
    expect(summary.formula).toBe('1d20 + 12')
    expect(summary.total).toBe(13)
  })

  it('finds the d20 with its raw face', () => {
    expect(summary.dice).toEqual([{ formula: '1d20', flavor: undefined, faces: 20, results: [1] }])
  })

  it('is not healing and has no flavors', () => {
    expect(summary.isHealing).toBe(false)
    expect(summary.flavors).toEqual([])
  })
})

describe('rollSummary — real DamageRolls', () => {
  it('parses a single-instance typed roll (2d6[fire])', () => {
    const summary = rollSummary(damageSimple)!
    expect(summary.className).toBe('DamageRoll')
    expect(summary.total).toBe(8)
    expect(summary.dice).toEqual([{ formula: '2d6', flavor: 'fire', faces: 6, results: [6, 2] }])
    expect(summary.flavors).toContain('fire')
    expect(summary.isHealing).toBe(false)
  })

  it('walks a multi-instance roll through InstancePool/Grouping/ArithmeticExpression', () => {
    const summary = rollSummary(damageMultiInstance)!
    // The persistent instance's die is found even though it contributes 0 to
    // the immediate total (persistent damage applies later).
    expect(summary.total).toBe(13)
    expect(summary.dice).toEqual([
      { formula: '2d6', flavor: undefined, faces: 6, results: [6, 3] },
      { formula: '1d4', flavor: 'persistent,acid', faces: 4, results: [4] }
    ])
    expect(summary.flavors).toContain('fire')
    expect(summary.flavors).toContain('persistent,acid')
    expect(summary.isHealing).toBe(false)
  })

  it('detects healing from the instance flavor', () => {
    const summary = rollSummary(damageHealing)!
    expect(summary.isHealing).toBe(true)
    expect(summary.dice).toEqual([{ formula: '2d8', flavor: 'healing', faces: 8, results: [2, 2] }])
    expect(summary.total).toBe(4)
  })

  it('does NOT read an untyped roll as healing', () => {
    // PF2e 8.x serializes a kind-less damage instance with the combined
    // flavor "damage,healing"; only an exact 'healing' type/kind may count.
    const summary = rollSummary(damageUntyped)!
    expect(summary.isHealing).toBe(false)
    expect(summary.total).toBe(18)
    expect(summary.dice).toEqual([
      { formula: '3d8', flavor: undefined, faces: 8, results: [7, 6, 3] }
    ])
  })
})

describe('rollSummary — synthetic shapes the parser contracts to handle', () => {
  it('detects healing from a kinds array on a term', () => {
    const roll = {
      class: 'DamageRoll',
      total: 5,
      terms: [
        {
          class: 'Die',
          number: 1,
          faces: 8,
          results: [{ result: 5, active: true }],
          options: { kinds: ['healing'] }
        }
      ]
    }
    expect(rollSummary(roll)!.isHealing).toBe(true)
  })

  it('excludes inactive (discarded) die results', () => {
    const roll = {
      class: 'CheckRoll',
      total: 15,
      terms: [
        {
          class: 'Die',
          number: 2,
          faces: 20,
          results: [
            { result: 3, active: false },
            { result: 15, active: true }
          ]
        }
      ]
    }
    expect(rollSummary(roll)!.dice[0].results).toEqual([15])
  })

  it('falls back to damage-results dice when die terms carry no results (spent rolls)', () => {
    const roll = {
      class: 'DamageRoll',
      total: 9,
      terms: [],
      result: {
        diceResults: {
          fire: {
            base: [
              { faces: 6, result: 3 },
              { faces: 6, result: 4 }
            ],
            splash: [{ faces: 4, result: 2 }]
          }
        }
      }
    }
    expect(rollSummary(roll)!.dice).toEqual([
      { formula: '2d6', flavor: 'fire', faces: 6, results: [3, 4] },
      { formula: '1d4', flavor: 'fire splash', faces: 4, results: [2] }
    ])
  })

  it('survives self-referential term graphs without recursing forever', () => {
    const die = {
      class: 'Die',
      number: 1,
      faces: 6,
      results: [{ result: 4, active: true }]
    } as Record<string, unknown>
    die.terms = [die]
    const roll = { class: 'DamageRoll', total: 4, terms: [die] }
    expect(rollSummary(roll)!.dice).toHaveLength(1)
  })

  it('returns undefined when there is nothing displayable', () => {
    expect(rollSummary(undefined)).toBeUndefined()
    expect(rollSummary('not json')).toBeUndefined()
    expect(rollSummary({})).toBeUndefined()
  })
})

describe('rollSummaries', () => {
  it('summarizes a message-rolls array, dropping unparsable entries', () => {
    const summaries = rollSummaries([checkRollNat1, 'garbage', damageSimple])
    expect(summaries.map((s) => s.className)).toEqual(['CheckRoll', 'DamageRoll'])
  })

  it('returns [] for undefined', () => {
    expect(rollSummaries(undefined)).toEqual([])
  })
})
