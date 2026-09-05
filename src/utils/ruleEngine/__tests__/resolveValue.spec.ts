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
