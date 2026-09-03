import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'

// The questions adding an item would ask, described by the system rather than
// reimplemented (see itemChoices.ts for why porting ChoiceSet app-side is not on
// offer). What matters is the four ways this could be wrong:
//
//   * reporting a question that PF2e would never actually ask — a ChoiceSet
//     whose predicate fails returns from preCreate before it prompts, so
//     treating it as pending would block items that add fine today;
//   * reporting NO question when PF2e would ask one, which lets the create
//     through to open a dialog on the GM's screen — the whole bug this exists
//     to close;
//   * writing an answer onto the wrong rule, which leaves the real ChoiceSet
//     unanswered while looking answered;
//   * claiming a question is answerable when there is nothing to pick from.

interface FakeRule {
  key: string
  flag?: string
  prompt?: string
  label?: string
  predicate?: unknown
  ignored?: boolean
  inflate?: () => Promise<{ value: string | number; label: string; img?: string }[]>
  predicatePasses?: boolean
}

let preparedRules: FakeRule[] = []

// Stands in for a prepared PF2e item. `prepareRuleElements` is what
// ItemPF2e.createDocuments calls before touching preCreate, and the rule objects
// it hands back are what carry `inflateChoices`.
class FakeItem {
  constructor(
    public source: Record<string, unknown>,
    public context: unknown
  ) {}
  prepareRuleElements() {
    return preparedRules.map((rule) => ({
      ...rule,
      resolveInjectedProperties: (value: unknown) => ({
        test: () => rule.predicatePasses !== false,
        value
      }),
      inflateChoices: rule.inflate ?? (async () => [])
    }))
  }
  getRollOptions() {
    return ['self:level:5']
  }
}

vi.mock('@/foundry/globals', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/globals')>()
  return { ...actual, itemClass: () => FakeItem }
})

const { applyChoiceSelections, pendingItemChoices } = await import('@/foundry/handlers/itemChoices')

const actor = { getRollOptions: () => ['self:trait:human'] } as unknown as ActorPF2e

function source(rules: Record<string, unknown>[]): Record<string, unknown> {
  return { name: 'Test Item', type: 'feat', system: { rules } }
}

beforeEach(() => {
  preparedRules = []
})

describe('applyChoiceSelections', () => {
  it('writes an answer onto the rule its index names', () => {
    const item = source([{ key: 'GrantItem' }, { key: 'ChoiceSet', flag: 'weapon' }])

    applyChoiceSelections(item, [{ ruleIndex: 1, value: 'longsword' }])

    const rules = (item.system as { rules: Record<string, unknown>[] }).rules
    expect(rules[1].selection).toBe('longsword')
    // Not the neighbour.
    expect(rules[0].selection).toBeUndefined()
  })

  // Addressed by index rather than by `flag` because a flag is optional, is
  // derived from the item slug when absent, and two ChoiceSets on one item can
  // share one.
  it('answers each of two ChoiceSets separately', () => {
    const item = source([{ key: 'ChoiceSet' }, { key: 'ChoiceSet' }])

    applyChoiceSelections(item, [
      { ruleIndex: 0, value: 'first' },
      { ruleIndex: 1, value: 'second' }
    ])

    const rules = (item.system as { rules: Record<string, unknown>[] }).rules
    expect(rules.map((r) => r.selection)).toEqual(['first', 'second'])
  })

  // A stale app talking about a different version of the item. Writing the
  // selection anyway would leave it on a rule that ignores it, while the real
  // ChoiceSet stayed unanswered — and the create would then prompt the GM.
  it('refuses an index that does not name a ChoiceSet', () => {
    const item = source([{ key: 'FlatModifier' }])

    applyChoiceSelections(item, [{ ruleIndex: 0, value: 'nope' }])

    expect((item.system as { rules: Record<string, unknown>[] }).rules[0].selection).toBeUndefined()
  })

  it('tolerates an index past the end of the rules', () => {
    const item = source([{ key: 'ChoiceSet' }])
    expect(() => applyChoiceSelections(item, [{ ruleIndex: 9, value: 'x' }])).not.toThrow()
  })
})

describe('pendingItemChoices', () => {
  it('is empty for an item with no rules at all', async () => {
    expect(await pendingItemChoices(actor, source([]))).toEqual([])
  })

  it('is empty for an item whose rules hold no ChoiceSet', async () => {
    preparedRules = [{ key: 'GrantItem' }]
    expect(await pendingItemChoices(actor, source([{ key: 'GrantItem' }]))).toEqual([])
  })

  it('reports a ChoiceSet with its inflated options', async () => {
    preparedRules = [
      {
        key: 'ChoiceSet',
        flag: 'weapon',
        prompt: 'Choose a weapon',
        label: 'Weapon Specialist',
        inflate: async () => [
          { value: 'longsword', label: 'Longsword', img: 'ls.webp' },
          { value: 'rapier', label: 'Rapier' }
        ]
      }
    ]

    const pending = await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))

    expect(pending).toEqual([
      {
        ruleIndex: 0,
        flag: 'weapon',
        prompt: 'Choose a weapon',
        label: 'Weapon Specialist',
        options: [
          { value: 'longsword', label: 'Longsword', img: 'ls.webp' },
          { value: 'rapier', label: 'Rapier' }
        ]
      }
    ])
  })

  // The condition both callers actually want: the app asks to know what to
  // render, and the create asks again to know whether it is safe to proceed.
  it('is empty once the ChoiceSet carries a selection', async () => {
    preparedRules = [{ key: 'ChoiceSet', inflate: async () => [{ value: 'a', label: 'A' }] }]
    const item = source([{ key: 'ChoiceSet', selection: 'longsword' }])

    expect(await pendingItemChoices(actor, item)).toEqual([])
  })

  it('is empty for a selection the app just wrote in', async () => {
    preparedRules = [{ key: 'ChoiceSet', inflate: async () => [{ value: 'a', label: 'A' }] }]
    const item = source([{ key: 'ChoiceSet' }])

    applyChoiceSelections(item, [{ ruleIndex: 0, value: 'a' }])

    expect(await pendingItemChoices(actor, item)).toEqual([])
  })

  // preCreate returns before it reaches the dialog when the predicate fails, so
  // this ChoiceSet never asks anything. Refusing on account of it would block
  // items that add perfectly well today.
  it('skips a ChoiceSet whose predicate fails', async () => {
    preparedRules = [
      {
        key: 'ChoiceSet',
        predicate: ['self:trait:elf'],
        predicatePasses: false,
        inflate: async () => [{ value: 'a', label: 'A' }]
      }
    ]

    expect(await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))).toEqual([])
  })

  it('reports a ChoiceSet whose predicate passes', async () => {
    preparedRules = [
      {
        key: 'ChoiceSet',
        predicate: ['self:trait:human'],
        predicatePasses: true,
        inflate: async () => [{ value: 'a', label: 'A' }]
      }
    ]

    expect(await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))).toHaveLength(1)
  })

  it('skips a rule PF2e has already marked ignored', async () => {
    preparedRules = [
      { key: 'ChoiceSet', ignored: true, inflate: async () => [{ value: 'a', label: 'A' }] }
    ]
    expect(await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))).toEqual([])
  })

  // A drop-only ChoiceSet: PF2e satisfies it by dragging an item onto its own
  // dialog, so there is no list to send and the app has to say so rather than
  // render an empty box or let the create through.
  it('marks a choice with no options unanswerable', async () => {
    preparedRules = [{ key: 'ChoiceSet', label: 'Drop an item', inflate: async () => [] }]

    const pending = await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))

    expect(pending).toHaveLength(1)
    expect(pending[0].unanswerable).toBe(true)
    expect(pending[0].options).toEqual([])
  })

  // Reporting it as "no choice needed" would let the create through to prompt
  // the GM, which is exactly the failure this module exists to prevent.
  it('marks a choice unanswerable when inflation throws, rather than skipping it', async () => {
    preparedRules = [
      {
        key: 'ChoiceSet',
        inflate: async () => {
          throw new Error('CONFIG path missing')
        }
      }
    ]

    const pending = await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))

    expect(pending).toHaveLength(1)
    expect(pending[0].unanswerable).toBe(true)
  })

  it('reports the second of two ChoiceSets once the first is answered', async () => {
    preparedRules = [
      { key: 'ChoiceSet', label: 'First', inflate: async () => [{ value: 'a', label: 'A' }] },
      { key: 'ChoiceSet', label: 'Second', inflate: async () => [{ value: 'b', label: 'B' }] }
    ]
    const item = source([{ key: 'ChoiceSet' }, { key: 'ChoiceSet' }])

    expect((await pendingItemChoices(actor, item)).map((c) => c.label)).toEqual(['First', 'Second'])

    applyChoiceSelections(item, [{ ruleIndex: 0, value: 'a' }])

    const remaining = await pendingItemChoices(actor, item)
    expect(remaining.map((c) => c.label)).toEqual(['Second'])
    expect(remaining[0].ruleIndex).toBe(1)
  })

  it('tolerates missing prompt and label rather than emitting undefined', async () => {
    preparedRules = [{ key: 'ChoiceSet', inflate: async () => [{ value: 'a', label: 'A' }] }]

    const [pending] = await pendingItemChoices(actor, source([{ key: 'ChoiceSet' }]))

    expect(pending.flag).toBe('')
    expect(pending.prompt).toBe('')
    expect(pending.label).toBe('')
  })
})
