import { describe, it, expect } from 'vitest'
import { buildRollOptions, asPersistent } from '@/utils/ruleEngine/rollOptions'
import { testPredicate } from '@/utils/ruleEngine/predicate'
import { collectFlatModifiers } from '@/utils/ruleEngine/flatModifiers'
import { sealLedger } from '@/utils/ruleEngine/ledger'

// Where an option comes from decides whether "absent" is an answer or an
// admission, and the two were previously the same thing.
//
//   base     persistent actor state. Enumerated, so absent means absent.
//   context  supplied by a roll that has not happened. Absent BY DEFINITION —
//            PF2e's own statistics are built with no item, origin or target,
//            and it keeps such modifiers in its list with `enabled: false`.
//   opaque   might be base state; the engine cannot tell. The only honest
//            unknown, and the only one that should cost a figure its confidence.

const options = (extra: Parameters<typeof buildRollOptions>[0] = {}) =>
  buildRollOptions({
    level: 5,
    traits: ['human'],
    items: [{ type: 'feat', system: { slug: 'ageless-patience', rules: [] } }],
    traitVocabulary: ['emotion', 'trap', 'inhaled'],
    ...extra
  })

describe('classifying an atom', () => {
  it('calls the actor’s own state base', () => {
    const o = options()
    expect(o.kindOf('self:trait:human')).toBe('base')
    expect(o.kindOf('self:level:5')).toBe('base')
    expect(o.kindOf('self:item:ageless-patience')).toBe('base')
  })

  it('calls what a roll supplies context', () => {
    const o = options()
    expect(o.kindOf('action:aid')).toBe('context')
    expect(o.kindOf('target:trait:undead')).toBe('context')
    expect(o.kindOf('origin:trait:trap')).toBe('context')
    // `item:` is context ONLY because this engine derives no strikes: PF2e
    // passes the weapon for a strike and nothing for a skill or a save.
    expect(o.kindOf('item:trait:inhaled')).toBe('context')
    expect(o.kindOf('item:type:spell')).toBe('context')
  })

  it('reads a bare trait name as one of the roll’s traits', () => {
    // `emotion` is what you are rolling AGAINST. Nothing marks it as such in the
    // string, which is why the trait vocabulary has to say so.
    expect(options().kindOf('emotion')).toBe('context')
    expect(options().kindOf('trap')).toBe('context')
  })

  it('leaves a bare toggle slug opaque', () => {
    // Indistinguishable from a trait as a string, and not a trait — so the
    // engine must not claim it is absent.
    expect(options().kindOf('ageless-patience')).toBe('opaque')
    expect(options().kindOf('feature:vindicator')).toBe('opaque')
  })

  it('stays opaque with no trait vocabulary, rather than guessing', () => {
    const o = options({ traitVocabulary: undefined })
    expect(o.kindOf('emotion')).toBe('opaque')
    // The prefixed families do not need the vocabulary.
    expect(o.kindOf('action:aid')).toBe('context')
  })

  it('takes the GM reporting an option as evidence it is actor state', () => {
    // The report says some rule sets it, so it is not roll context — but with
    // that rule out of sight its toggle position is unknown, and unknown is the
    // honest answer rather than absent.
    const o = options({ activeRules: ['emotion'] })
    expect(o.kindOf('emotion')).toBe('opaque')
  })

  it('settles it when the declaring rule is one we can see', () => {
    const o = options({
      activeRules: ['ageless-patience'],
      items: [
        {
          type: 'feat',
          system: {
            slug: 'ageless-patience',
            rules: [{ key: 'RollOption', option: 'ageless-patience', toggleable: true }]
          }
        }
      ]
    })
    expect(o.kindOf('ageless-patience')).toBe('base')
    // Toggleable with no value set is OFF, per PF2e's own schema default.
    expect(o.has('ageless-patience')).toBe(false)
  })
})

describe('the two readings', () => {
  const o = options()

  it('answers as PF2e does when the roll is supposed', () => {
    // PF2e's `predicate.test([])`: an option the roll did not supply is false.
    expect(testPredicate(['emotion'], o)).toBe('false')
    expect(testPredicate(['item:type:spell'], o)).toBe('false')
  })

  it('applies a modifier that a roll would take AWAY', () => {
    // The direction that matters and is easy to get backwards: absent means the
    // negation holds, so this modifier is on at rest — as it is in PF2e.
    expect(testPredicate([{ not: 'target:trait:undead' }], o)).toBe('true')
  })

  it('withholds context when asked to explain a false', () => {
    expect(testPredicate(['emotion'], asPersistent(o))).toBe('unknown')
    expect(testPredicate([{ not: 'target:trait:undead' }], asPersistent(o))).toBe('unknown')
  })

  it('keeps an opaque atom unknown under both readings', () => {
    expect(testPredicate(['ageless-patience'], o)).toBe('unknown')
    expect(testPredicate(['ageless-patience'], asPersistent(o))).toBe('unknown')
  })

  it('still resolves a conjunction that one false settles', () => {
    // Kleene: an AND with a false arm is false whatever the other arms are, so
    // an opaque atom beside a context one costs nothing.
    expect(testPredicate(['item:type:spell', 'divine-grace'], o)).toBe('false')
  })
})

// What the classification is FOR: a modifier waiting on a roll is not a gap.
describe('collecting a modifier that depends on the roll', () => {
  const withRule = (predicate: unknown) => [
    {
      name: 'Forlorn',
      type: 'feat',
      system: {
        slug: 'forlorn',
        rules: [
          {
            key: 'FlatModifier',
            selector: 'will',
            slug: 'against-emotion-effects',
            type: 'circumstance',
            value: 1,
            predicate
          }
        ]
      }
    }
  ]

  const collect = (predicate: unknown, vocabulary = ['emotion']) =>
    collectFlatModifiers(
      withRule(predicate) as never,
      ['will'],
      buildRollOptions({
        level: 5,
        items: withRule(predicate) as never,
        traitVocabulary: vocabulary
      }),
      { paths: {} }
    )

  it('records it as conditional rather than skipping it', () => {
    const result = collect(['emotion'])
    expect(result.skipped).toEqual([])
    expect(result.conditional.map((c) => c.slug)).toEqual(['against-emotion-effects'])
    // And it contributes nothing, which is what PF2e reports too.
    expect(result.modifiers).toEqual([])
  })

  it('carries enough to say what it is conditional ON', () => {
    const [conditional] = collect(['emotion']).conditional
    expect(conditional.modifier).toBe(1)
    expect(conditional.type).toBe('circumstance')
    expect(conditional.itemName).toBe('Forlorn')
    expect(conditional.predicate).toEqual(['emotion'])
  })

  it('still skips one the engine genuinely cannot resolve', () => {
    const result = collect(['ageless-patience'], [])
    expect(result.conditional).toEqual([])
    expect(result.skipped.map((s) => s.reason)).toEqual(['unresolvable-predicate'])
  })

  it('applies one the roll could only take away', () => {
    const result = collect([{ not: 'target:trait:undead' }])
    expect(result.skipped).toEqual([])
    expect(result.conditional).toEqual([])
    expect(result.modifiers.map((m) => m.modifier)).toEqual([1])
  })

  it('offers nothing to show for one this character can never trigger', () => {
    // False under both readings: not conditional, just inapplicable.
    const result = collect(['self:trait:elf'])
    expect(result.skipped).toEqual([])
    expect(result.conditional).toEqual([])
    expect(result.modifiers).toEqual([])
  })
})

// A figure whose only unaccounted modifiers are conditional is not a less
// certain figure. It is the same number PF2e reports, reached the same way.
describe('what conditionals do to confidence', () => {
  it('leaves a figure exact', () => {
    expect(
      sealLedger(
        {
          applied: 3,
          skipped: [],
          conditional: [{ slug: 'x', label: 'x', modifier: 1, type: 'circumstance' }]
        },
        'verified'
      ).confidence
    ).toBe('exact')
  })

  it('while a real skip still makes it provisional', () => {
    expect(
      sealLedger(
        {
          applied: 3,
          skipped: [{ reason: 'unresolvable-predicate', key: 'FlatModifier' }],
          conditional: []
        },
        'verified'
      ).confidence
    ).toBe('provisional')
  })
})

// PF2e's own set, when the GM sends one, replaces the inference rather than
// adding to it. This is the "feed it rather than re-implement it" move the roll
// path already made with `enableOptions`.
describe('PF2e’s own roll-option set', () => {
  const agelessPatience = {
    type: 'feat',
    name: 'Ageless Patience',
    system: {
      slug: 'ageless-patience',
      rules: [{ key: 'RollOption', option: 'ageless-patience', toggleable: true }]
    }
  }

  it('reads a toggle’s state instead of guessing it', () => {
    // Inferred, the rule is toggleable with no stored value, so PF2e's schema
    // default says OFF — the right guess, and still a guess.
    const guessed = buildRollOptions({ items: [agelessPatience], activeRules: ['ageless-patience'] })
    expect(guessed.has('ageless-patience')).toBe(false)

    // Told, it is ON, because PF2e enumerated it. No amount of reading the
    // rule's source fields could have found that out.
    const told = buildRollOptions({
      items: [agelessPatience],
      activeRules: ['ageless-patience'],
      rollOptionSet: ['ageless-patience']
    })
    expect(told.has('ageless-patience')).toBe(true)
    expect(told.kindOf('ageless-patience')).toBe('base')
  })

  it('does not leave a toggle undecidable once PF2e has answered', () => {
    // A formula-valued toggle is unguessable from source, so the inference
    // marks it opaque and every predicate touching it costs a figure its
    // confidence. The authoritative set settles it.
    const formula = {
      type: 'feat',
      name: 'Odd',
      system: {
        slug: 'odd',
        rules: [{ key: 'RollOption', option: 'odd:toggle', value: '@actor.level' }]
      }
    }
    expect(
      buildRollOptions({ items: [formula], activeRules: ['odd:toggle'] }).kindOf('odd:toggle')
    ).toBe('opaque')
    expect(
      buildRollOptions({
        items: [formula],
        activeRules: ['odd:toggle'],
        rollOptionSet: []
      }).kindOf('odd:toggle')
    ).toBe('opaque')
    expect(
      buildRollOptions({
        items: [formula],
        activeRules: ['odd:toggle'],
        rollOptionSet: ['odd:toggle']
      }).kindOf('odd:toggle')
    ).toBe('base')
  })

  it('still treats a roll-context atom as context, not as absent-in-fact', () => {
    // The set describes the actor at rest. Nothing has declared an action or
    // chosen a target, so those stay conditional rather than becoming facts —
    // and a local write since the payload could have moved anything else, which
    // is why an unlisted, unfamiliar atom stays opaque.
    const o = buildRollOptions({ rollOptionSet: ['self:armored', 'self:trait:elf'] })
    expect(o.kindOf('action:aid')).toBe('context')
    expect(o.kindOf('target:trait:undead')).toBe('context')
    expect(o.kindOf('some:unlisted:thing')).toBe('opaque')
    expect(o.kindOf('self:armored')).toBe('base')
  })
})

// Proficiency ranks reach predicates as PF2e's own option strings, and the
// FAMILY has to be answerable for a numeric comparison to resolve.
describe('rank options', () => {
  it('answers a rank comparison across the whole family', () => {
    const o = buildRollOptions({ rankOptions: ['save:fortitude:rank:2', 'perception:rank:3'] })
    expect(o.has('save:fortitude:rank:2')).toBe(true)
    expect(o.kindOf('save:fortitude:rank:2')).toBe('base')
    // Not present, but ANSWERABLE — which is what makes a `gte` resolve to a
    // definite false rather than an unknown.
    expect(o.knows('save:fortitude:rank:0')).toBe(true)
    expect(o.has('save:fortitude:rank:0')).toBe(false)
    expect(testPredicate([{ gte: ['save:fortitude:rank', 2] }], o)).toBe('true')
    expect(testPredicate([{ gte: ['perception:rank', 4] }], o)).toBe('false')
  })

  it('says nothing about a family it was given no rank for', () => {
    const o = buildRollOptions({ rankOptions: ['save:fortitude:rank:2'] })
    expect(testPredicate([{ gte: ['skill:athletics:rank', 1] }], o)).toBe('unknown')
  })
})
