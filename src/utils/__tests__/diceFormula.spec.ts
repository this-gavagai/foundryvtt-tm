import { describe, it, expect } from 'vitest'
import {
  parseDamageFormulaDice,
  resolveFormula,
  simplifyFormula,
  simplifyFormulaHtml,
  makeDiceResults
} from '@/utils/diceFormula'

// diceFormula drives what physical dice the user is asked to roll and what
// formula ultimately reaches Foundry. The tables below start from the
// documented examples in the module's own comments and pin the interleaved
// function/paren simplification that inline @Damage formulas depend on.

describe('parseDamageFormulaDice', () => {
  it.each([
    ['1d8+5', ['d8']],
    ['2d6+1d4[fire]', ['d6', 'd6', 'd4']],
    ['(1d6+2)[fire]', ['d6']],
    ['{2d6}[persistent,fire] + 1d4[acid]', ['d6', 'd6', 'd4']],
    ['10d6', ['d6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6']],
    ['5', []],
    ['', []]
  ])('%s → %j', (formula, expected) => {
    expect(parseDamageFormulaDice(formula)).toEqual(expected)
  })

  it('returns [] for undefined', () => {
    expect(parseDamageFormulaDice(undefined)).toEqual([])
  })
})

describe('resolveFormula', () => {
  it('substitutes dotted-path refs against rollData', () => {
    expect(resolveFormula('(@item.level)d6[fire]', { item: { level: 3 } })).toBe('(3)d6[fire]')
  })

  it('resolves deep paths', () => {
    expect(
      resolveFormula('1d20+@actor.abilities.str.mod', {
        actor: { abilities: { str: { mod: 4 } } }
      })
    ).toBe('1d20+4')
  })

  it('leaves unresolvable refs intact so evaluation surfaces a clear error', () => {
    expect(resolveFormula('(@item.level)d6', { item: {} })).toBe('(@item.level)d6')
  })

  it('leaves refs that resolve to objects intact', () => {
    expect(resolveFormula('(@item)d6', { item: { level: 3 } })).toBe('(@item)d6')
  })

  it('passes the formula through when rollData is missing', () => {
    expect(resolveFormula('(@item.level)d6', null)).toBe('(@item.level)d6')
    expect(resolveFormula('(@item.level)d6', undefined)).toBe('(@item.level)d6')
  })
})

describe('simplifyFormula', () => {
  it('resolves refs then evaluates math functions (documented example)', () => {
    expect(simplifyFormula('(floor(@item.rank/2))d6[persistent,acid]', { item: { rank: 5 } })).toBe(
      '2d6[persistent,acid]'
    )
  })

  it('interleaves paren collapse and function evaluation (documented example)', () => {
    // floor((@item.rank-1)/2): the inner paren must collapse before floor()
    // can evaluate, and the outer (1+floor(...)) only after that.
    expect(simplifyFormula('(1+floor((@item.rank-1)/2))d10', { item: { rank: 5 } })).toBe('3d10')
  })

  it('evaluates the other safe math functions', () => {
    expect(simplifyFormula('(max(1,3))d4', {})).toBe('3d4')
    expect(simplifyFormula('(ceil(5/2))d8', {})).toBe('3d8')
  })

  it('leaves formulas with unresolved refs untouched', () => {
    expect(simplifyFormula('(@item.level)d6', {})).toBe('(@item.level)d6')
    expect(simplifyFormula('(floor(@item.rank/2))d6', {})).toBe('(floor(@item.rank/2))d6')
  })

  it('passes plain formulas through unchanged', () => {
    expect(simplifyFormula('2d8+4', {})).toBe('2d8+4')
    expect(simplifyFormula('1d20 + 12', null)).toBe('1d20 + 12')
  })
})

describe('simplifyFormulaHtml', () => {
  it('wraps each computed value in the green display span', () => {
    expect(simplifyFormulaHtml('(2+3)d6', {})).toBe('<span class="text-green-400">5</span>d6')
  })

  it('strips its own markup when nesting so outer passes still evaluate', () => {
    expect(simplifyFormulaHtml('(1+floor((@item.rank-1)/2))d10', { item: { rank: 5 } })).toBe(
      '<span class="text-green-400">3</span>d10'
    )
  })
})

describe('makeDiceResults', () => {
  it('groups an ordered face array by die size (documented example)', () => {
    expect(makeDiceResults(['d6', 'd6', 'd4'], [3, 5, 2])).toEqual({ d6: [3, 5], d4: [2] })
  })

  it('keeps per-die order within a group', () => {
    expect(makeDiceResults(['d8', 'd4', 'd8'], [1, 2, 3])).toEqual({ d8: [1, 3], d4: [2] })
  })

  it('returns an empty payload for no dice', () => {
    expect(makeDiceResults([], [])).toEqual({})
  })
})
