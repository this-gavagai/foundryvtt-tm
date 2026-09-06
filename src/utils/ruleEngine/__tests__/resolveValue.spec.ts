import { describe, it, expect } from 'vitest'
import { resolveValue } from '@/utils/ruleEngine/resolveValue'

const context = { paths: { 'actor.level': 7, 'actor.details.level.value': 7 } }

describe('literals', () => {
  it('takes numbers and booleans as they are', () => {
    expect(resolveValue(3, context)).toEqual({ ok: true, value: 3 })
    expect(resolveValue(true, context)).toEqual({ ok: true, value: 1 })
    expect(resolveValue(null, context)).toEqual({ ok: true, value: 0 })
  })
})

describe('formulas', () => {
  it('evaluates arithmetic and precedence', () => {
    expect(resolveValue('2 + 3 * 4', context)).toEqual({ ok: true, value: 14 })
    expect(resolveValue('(2 + 3) * 4', context)).toEqual({ ok: true, value: 20 })
    expect(resolveValue('-3', context)).toEqual({ ok: true, value: -3 })
  })

  it('evaluates the functions PF2e formulas use', () => {
    expect(resolveValue('floor(7 / 2)', context)).toEqual({ ok: true, value: 3 })
    expect(resolveValue('ceil(7 / 2)', context)).toEqual({ ok: true, value: 4 })
    expect(resolveValue('max(1, 4, 2)', context)).toEqual({ ok: true, value: 4 })
  })

  it('substitutes paths it has been given', () => {
    expect(resolveValue('@actor.level', context)).toEqual({ ok: true, value: 7 })
    expect(resolveValue('floor(@actor.level / 2)', context)).toEqual({ ok: true, value: 3 })
  })

  it('reads an item badge, for a valued effect', () => {
    // "-@item.badge.value" is how Frightened and friends express themselves.
    expect(resolveValue('-@item.badge.value', { ...context, itemBadge: 2 })).toEqual({
      ok: true,
      value: -2
    })
  })
})

describe('PF2e’s own Math helpers', () => {
  // These are the largest single source of unresolvable values on a real
  // character: Untrained Improvisation is a match/when chain, and rank upgrades
  // routinely use ternary.
  it('evaluates Untrained Improvisation verbatim', () => {
    const formula =
      'match(when(lte(@actor.level, 4), @actor.level - 2), ' +
      'when(btwn(@actor.level, 5, 6), @actor.level - 1), ' +
      'when(gte(@actor.level, 7), @actor.level))'
    // Level 7 arm: the whole level.
    expect(resolveValue(formula, { paths: { 'actor.level': 9 } })).toEqual({ ok: true, value: 9 })
    // Level 5-6 arm: level - 1. This is the case seen live, and it read 4.
    expect(resolveValue(formula, { paths: { 'actor.level': 5 } })).toEqual({ ok: true, value: 4 })
    // Level <= 4 arm: level - 2.
    expect(resolveValue(formula, { paths: { 'actor.level': 3 } })).toEqual({ ok: true, value: 1 })
  })

  it('evaluates ternary, as rank upgrades use it', () => {
    const formula = 'ternary(gte(@actor.level,5),2,1)'
    expect(resolveValue(formula, { paths: { 'actor.level': 5 } })).toEqual({ ok: true, value: 2 })
    expect(resolveValue(formula, { paths: { 'actor.level': 4 } })).toEqual({ ok: true, value: 1 })
  })

  it('lets when yield null and match pick the first non-null', () => {
    // The pair is the point: a number-only evaluator cannot express `when`.
    const ctx = { paths: { 'actor.level': 5 } }
    expect(resolveValue('match(when(gt(@actor.level,10), 99), when(gt(@actor.level,1), 7))', ctx)).toEqual({ ok: true, value: 7 })
    // No arm matches: match's own `?? 0`.
    expect(resolveValue('match(when(gt(@actor.level,10), 99))', ctx)).toEqual({ ok: true, value: 0 })
  })

  it('coerces a bare comparison the way arithmetic would', () => {
    const ctx = { paths: { 'actor.level': 5 } }
    expect(resolveValue('gte(@actor.level, 5)', ctx)).toEqual({ ok: true, value: 1 })
    expect(resolveValue('lt(@actor.level, 5)', ctx)).toEqual({ ok: true, value: 0 })
  })
})

describe('refusals', () => {
  it('refuses a path it was not given', () => {
    // The central refusal: most of what a rule wants to read about an actor is
    // derived, and guessing zero would be a silent, plausible wrong answer.
    const result = resolveValue('@actor.abilities.str.mod', context)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: expect.stringContaining('unreachable') })
  })

  it('refuses a badge reference with no badge present', () => {
    expect(resolveValue('@item.badge.value', context).ok).toBe(false)
  })

  it('refuses syntax it does not implement rather than falling back to eval', () => {
    expect(resolveValue('2 ** 8', context).ok).toBe(false)
    expect(resolveValue('sqrt(9)', context).ok).toBe(false)
    expect(resolveValue('1 +', context).ok).toBe(false)
  })

  it('refuses division by zero instead of returning Infinity', () => {
    expect(resolveValue('1 / 0', context).ok).toBe(false)
  })
})

describe('bracketed values', () => {
  it('picks the bracket the actor’s level falls in', () => {
    const brackets = {
      brackets: [
        { end: 4, value: 1 },
        { start: 5, end: 10, value: 2 },
        { start: 11, value: 3 }
      ]
    }
    expect(resolveValue(brackets, context)).toEqual({ ok: true, value: 2 })
  })

  it('reads an unmatched level as no modifier', () => {
    expect(resolveValue({ brackets: [{ start: 15, value: 4 }] }, context)).toEqual({
      ok: true,
      value: 0
    })
  })

  it('refuses a bracket keyed on something other than level', () => {
    const result = resolveValue(
      { field: 'actor|system.attributes.hp.max', brackets: [{ value: 1 }] },
      context
    )
    expect(result.ok).toBe(false)
  })
})
