// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'

// Toggling a roll option writes it onto every item that contributes it, which
// means the SET of items has to be the same set PF2e would pair together.
//
// PF2e's `#resolveSuboptionRules` filters the actor's rules on five things:
// `key`, `toggleable`, `mergeable`, `domain` and `option`. This used to match on
// `option` alone, which moved two independent toggles together whenever they
// shared an option string in different domains, and sent whole-array writes to
// items that had nothing to change.

// The toggle writes each contributing item's WHOLE rules array, so it goes
// through the named broad-write function rather than updateActorItem — see
// api/documents.ts. What this spec pins is unchanged either way: which items are
// written, and what their rule arrays say when they are.
const replaceItemRules = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))

vi.mock('@/api/documents', () => ({
  replaceItemRules: (...args: unknown[]) => replaceItemRules(...args)
}))

const { useCharacterRules } = await import('@/composables/character/characterRules')

type Rule = Record<string, unknown>
type Item = { _id: string; name: string; system: { rules: Rule[] } }

const rollOption = (over: Rule = {}): Rule => ({
  key: 'RollOption',
  domain: 'all',
  option: 'finisher',
  toggleable: true,
  value: false,
  ...over
})

// Cast at the fixture boundary, once — the same one the sibling character specs
// make: TablemateCharacter claims CharacterPF2e, but what the app holds is the
// plain JSON the Foundry side serialized with toObject().
function rulesOf(items: Item[]) {
  const actor = ref({
    _id: 'seelah',
    items,
    // Every option below has to be live for the model to surface it.
    activeRules: ['finisher', 'panache'],
    rollOptionLabels: {}
  }) as unknown as Ref<TablemateCharacter | undefined>
  const { rollOptions } = useCharacterRules(actor)
  // Field<T> is possibly-undefined by contract (it mirrors an actor that may
  // not have loaded). The fixture above always provides one, so unwrap here
  // rather than at every read below.
  return { rows: () => rollOptions.value! }
}

/** The ids and rule arrays handed to the write, as one readable pair. */
function written() {
  const [, updates] = replaceItemRules.mock.calls.at(-1) ?? []
  const entries = (updates ?? []) as { itemId: string; rules: Rule[] }[]
  return {
    ids: entries.map((entry) => entry.itemId),
    updates: entries.map((entry) => ({ system: { rules: entry.rules } }))
  }
}

beforeEach(() => vi.clearAllMocks())

describe('roll option rows', () => {
  // Keyed by (domain, option). On `option` alone these collapsed into one row,
  // so one of the two toggles was unreachable and the other moved both.
  it('keeps two options with the same name in different domains apart', () => {
    const { rows } = rulesOf([
      { _id: 'feat-a', name: 'A', system: { rules: [rollOption({ domain: 'all' })] } },
      { _id: 'feat-b', name: 'B', system: { rules: [rollOption({ domain: 'attack-roll' })] } }
    ])

    expect(rows().size).toBe(2)
    expect([...rows().keys()]).toEqual(['all:finisher', 'attack-roll:finisher'])
  })

  it('collapses the same option in the same domain into one row', () => {
    const { rows } = rulesOf([
      { _id: 'feat-a', name: 'A', system: { rules: [rollOption()] } },
      { _id: 'feat-b', name: 'B', system: { rules: [rollOption()] } }
    ])

    expect(rows().size).toBe(1)
  })

  // The row aggregates suboptions from every contributing item, which is why
  // the write below deliberately fans out to all of them: one control showing
  // both items' choices must not move only one item's state.
  it('aggregates suboptions across the items contributing one option', () => {
    const { rows } = rulesOf([
      {
        _id: 'feat-a',
        name: 'A',
        system: { rules: [rollOption({ suboptions: [{ label: 'Bleed', value: 'bleed' }] })] }
      },
      {
        _id: 'feat-b',
        name: 'B',
        system: {
          rules: [rollOption({ suboptions: [{ label: 'Confident', value: 'confident' }] })]
        }
      }
    ])

    expect(
      rows()
        .get('all:finisher')
        ?.suboptions.map((s) => s.value)
    ).toEqual(['bleed', 'confident'])
  })
})

describe('updateRule', () => {
  it('writes the toggle onto every item contributing that domain and option', () => {
    const { rows } = rulesOf([
      { _id: 'feat-a', name: 'A', system: { rules: [rollOption()] } },
      { _id: 'feat-b', name: 'B', system: { rules: [rollOption()] } }
    ])

    rows().get('all:finisher')?.updateRule(true, null)

    const { ids, updates } = written()
    expect(ids).toEqual(['feat-a', 'feat-b'])
    expect(updates.map((u) => u.system.rules[0].value)).toEqual([true, true])
  })

  // The bug this closes: same option string, different domain. PF2e treats
  // these as independent, and so must this.
  it('leaves the same option in another domain untouched', () => {
    const { rows } = rulesOf([
      { _id: 'feat-a', name: 'A', system: { rules: [rollOption({ domain: 'all' })] } },
      { _id: 'feat-b', name: 'B', system: { rules: [rollOption({ domain: 'attack-roll' })] } }
    ])

    rows().get('all:finisher')?.updateRule(true, null)

    expect(written().ids).toEqual(['feat-a'])
  })

  // Without a `key` check in the SELECTION, this item joined the set on a rule
  // that merely carried the same `option`, had nothing changed, and was still
  // sent a whole-array write of its rules.
  it('skips an item whose matching rule is not a RollOption', () => {
    const { rows } = rulesOf([
      { _id: 'feat-a', name: 'A', system: { rules: [rollOption()] } },
      {
        _id: 'feat-b',
        name: 'B',
        system: { rules: [{ key: 'Note', domain: 'all', option: 'finisher' }] }
      }
    ])

    rows().get('all:finisher')?.updateRule(true, null)

    expect(written().ids).toEqual(['feat-a'])
  })

  it('writes a suboption selection alongside the toggle', () => {
    const { rows } = rulesOf([
      {
        _id: 'feat-a',
        name: 'A',
        system: { rules: [rollOption({ suboptions: [{ label: 'Bleed', value: 'bleed' }] })] }
      }
    ])

    rows().get('all:finisher')?.updateRule(null, 'bleed')

    const rule = written().updates[0].system.rules[0]
    expect(rule.selection).toBe('bleed')
    // A null toggle means "leave the value alone" — the row was changing its
    // selection, not turning itself on.
    expect(rule.value).toBe(false)
  })

  it('writes only the rule it names when an item carries several', () => {
    const { rows } = rulesOf([
      {
        _id: 'feat-a',
        name: 'A',
        system: {
          rules: [rollOption({ option: 'panache' }), rollOption({ option: 'finisher' })]
        }
      }
    ])

    rows().get('all:finisher')?.updateRule(true, null)

    const rules = written().updates[0].system.rules
    expect(rules.find((r) => r.option === 'finisher')?.value).toBe(true)
    expect(rules.find((r) => r.option === 'panache')?.value).toBe(false)
  })
})
