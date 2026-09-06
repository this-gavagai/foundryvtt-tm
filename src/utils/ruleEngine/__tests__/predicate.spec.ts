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
    // A bare situational slug could be a property of an item genuinely in play.
    expect(testStatement('lit-torch', options)).toBe('unknown')
  })

  it('trusts a roll option the GM resolved AND the rule says is on', () => {
    // activeRules is PF2e's verdict on the rule's PREDICATE, not on the toggle.
    // The rule's own `value` carries the state, defaulting to `!toggleable`.
    const on = buildRollOptions({
      activeRules: ['self:armored'],
      items: [{ system: { rules: [{ key: 'RollOption', option: 'self:armored' }] } }]
    })
    expect(testStatement('self:armored', on)).toBe('true')
  })

  it('reads a toggleable option with no stored value as OFF', () => {
    // PF2e's schema: `value` has `initial: (data) => !data.toggleable`. One live
    // character's Ageless Patience — a toggle she had never flipped — was being
    // applied to perception and all sixteen skills.
    const off = buildRollOptions({
      activeRules: ['ageless-patience'],
      items: [
        { system: { rules: [{ key: 'RollOption', option: 'ageless-patience', toggleable: true }] } }
      ]
    })
    expect(testStatement('ageless-patience', off)).toBe('false')
  })

  it('refuses an option whose rule it cannot find', () => {
    // Granted by something outside the items we were handed: "the GM says this
    // rule applies" is not evidence that it is switched off.
    const orphan = buildRollOptions({ activeRules: ['self:armored'] })
    expect(testStatement('self:armored', orphan)).toBe('unknown')
  })
})

describe('what is absent at rest', () => {
  // A sheet figure is the value with no target selected and no action declared,
  // so these are knowably ABSENT rather than unseen. PF2e agrees visibly: it
  // lists Cooperative Nature — predicate ["action:aid"] — among a skill's
  // modifiers with `enabled: false`, contributing nothing.
  it('answers no to a roll-context family', () => {
    expect(testStatement('action:aid', options)).toBe('false')
    expect(testStatement('target:trait:undead', options)).toBe('false')
    expect(testStatement('origin:trait:curse', options)).toBe('false')
    expect(testStatement('self:action:slug:strike', options)).toBe('false')
  })

  it('lets a negation of one pass, as PF2e does against its own empty set', () => {
    // The direction that would be dangerous if it were a guess: this ADDS a
    // modifier. It is faithful because PF2e's set is genuinely empty here too.
    expect(testStatement({ not: 'target:trait:undead' }, options)).toBe('true')
  })

  it('still defers to a GM-reported option that a rule says is on', () => {
    const reported = buildRollOptions({
      activeRules: ['action:aid'],
      items: [{ system: { rules: [{ key: 'RollOption', option: 'action:aid' }] } }]
    })
    expect(testStatement('action:aid', reported)).toBe('true')
  })

  it('drops a whole predicate that needs an action', () => {
    // Cooperative Nature, verbatim.
    expect(testPredicate(['action:aid'], options)).toBe('false')
    // Thieves' Toolkit, verbatim.
    expect(
      testPredicate([{ or: ['action:disable-a-device', 'action:pick-a-lock'] }], options)
    ).toBe('false')
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
