import { describe, it, expect } from 'vitest'
import { testPredicate, testStatement } from '@/utils/ruleEngine/predicate'
import { buildRollOptions, emptyRollOptions } from '@/utils/ruleEngine/rollOptions'

// The three-valued logic is the load-bearing part of the whole engine: an
// unknown that decays into `false` produces a number that is wrong and looks
// exactly like a number that is right. These pin the distinction.

const options = buildRollOptions({
  level: 5,
  traits: ['human', 'humanoid'],
  items: [
    { type: 'effect', name: 'Rage', system: { slug: 'rage' } },
    { type: 'condition', name: 'Frightened', system: { slug: 'frightened' } }
  ]
})

describe('atomic statements', () => {
  it('answers within a family it enumerates', () => {
    expect(testStatement('self:trait:human', options)).toBe('true')
    expect(testStatement('self:trait:elf', options)).toBe('false')
    expect(testStatement('self:effect:rage', options)).toBe('true')
  })

  it('refuses a family it does not enumerate', () => {
    // `self:armored` depends on the equipped armour's DERIVED category. The
    // engine has no view of it, so the honest answer is neither yes nor no.
    expect(testStatement('self:armored', options)).toBe('unknown')
    expect(testStatement('target:condition:flat-footed', options)).toBe('unknown')
  })

  it('trusts a roll option the GM already resolved', () => {
    // activeRules is PF2e's own verdict on a RollOption rule, so an option there
    // is answerable even though its family is not one we enumerate.
    const withReported = buildRollOptions({ activeRules: ['self:armored'] })
    expect(testStatement('self:armored', withReported)).toBe('true')
  })
})

describe('binary operators', () => {
  it('compares against the numeric suffix of a known family', () => {
    expect(testStatement({ gte: ['self:level', 5] }, options)).toBe('true')
    expect(testStatement({ gt: ['self:level', 5] }, options)).toBe('false')
    expect(testStatement({ lt: ['self:level', 10] }, options)).toBe('true')
  })

  it('refuses a comparison whose left side it cannot enumerate', () => {
    expect(testStatement({ gte: ['target:level', 3] }, options)).toBe('unknown')
  })

  it('treats a string eq as a literal comparison, as PF2e does', () => {
    expect(testStatement({ eq: ['a', 'a'] }, options)).toBe('true')
    expect(testStatement({ eq: ['a', 'b'] }, options)).toBe('false')
  })
})

describe('compound operators use Kleene logic', () => {
  it('an or with a true arm is true even beside an unknown', () => {
    // No resolution of the unknown could change the answer, so refusing here
    // would cost coverage for nothing.
    expect(testStatement({ or: ['self:trait:human', 'self:armored'] }, options)).toBe('true')
  })

  it('an or with no true arm and an unknown arm is unknown', () => {
    expect(testStatement({ or: ['self:trait:elf', 'self:armored'] }, options)).toBe('unknown')
  })

  it('an and with a false arm is false even beside an unknown', () => {
    expect(testStatement({ and: ['self:trait:elf', 'self:armored'] }, options)).toBe('false')
  })

  it('an and with an unknown arm and no false arm is unknown', () => {
    expect(testStatement({ and: ['self:trait:human', 'self:armored'] }, options)).toBe('unknown')
  })

  it('negation preserves unknown rather than flipping it', () => {
    // The bug this guards: `not` over an unseen option is the classic way an
    // unknown becomes a confident, wrong `true`.
    expect(testStatement({ not: 'self:armored' }, options)).toBe('unknown')
    expect(testStatement({ not: 'self:trait:elf' }, options)).toBe('true')
  })

  it('nor and nand invert their compound, unknowns included', () => {
    expect(testStatement({ nor: ['self:trait:elf', 'self:trait:dwarf'] }, options)).toBe('true')
    expect(testStatement({ nor: ['self:trait:elf', 'self:armored'] }, options)).toBe('unknown')
    expect(testStatement({ nand: ['self:trait:human', 'self:trait:elf'] }, options)).toBe('true')
  })

  it('xor refuses when any arm is unknown', () => {
    expect(testStatement({ xor: ['self:trait:human', 'self:trait:elf'] }, options)).toBe('true')
    expect(testStatement({ xor: ['self:trait:human', 'self:armored'] }, options)).toBe('unknown')
  })
})

describe('whole predicates', () => {
  it('an empty predicate always holds', () => {
    expect(testPredicate([], options)).toBe('true')
    expect(testPredicate(undefined, options)).toBe('true')
  })

  it('is an implicit and over its statements', () => {
    expect(testPredicate(['self:trait:human', 'self:effect:rage'], options)).toBe('true')
    expect(testPredicate(['self:trait:human', 'self:trait:elf'], options)).toBe('false')
    expect(testPredicate(['self:trait:human', 'self:armored'], options)).toBe('unknown')
  })

  it('handles if/then, where a false antecedent discharges the statement', () => {
    expect(testPredicate([{ if: 'self:trait:elf', then: 'self:armored' }], options)).toBe('true')
    expect(testPredicate([{ if: 'self:trait:human', then: 'self:effect:rage' }], options)).toBe(
      'true'
    )
    expect(testPredicate([{ if: 'self:trait:human', then: 'self:armored' }], options)).toBe(
      'unknown'
    )
  })

  it('knows nothing against an empty option set', () => {
    expect(testPredicate(['self:trait:human'], emptyRollOptions())).toBe('unknown')
  })
})
