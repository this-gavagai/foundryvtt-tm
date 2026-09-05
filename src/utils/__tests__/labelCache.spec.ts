import { describe, it, expect } from 'vitest'
import { labelPayload } from './fixtures/labelPayload'
import {
  catalogsFromPayload,
  emptyLabelCatalogs,
  mergeLabelCatalogs,
  type LabelCatalogs
} from '@/utils/labelCache'

// The pure half of the label cache: what one character payload still
// contributes, and how a contribution folds into what is already held. The
// world catalog and the IndexedDB row are exercised through the store.

function catalogs(over: Partial<LabelCatalogs> = {}): LabelCatalogs {
  return { ...emptyLabelCatalogs(), ...over }
}

describe('catalogsFromPayload', () => {
  it('takes the actor RollOption labels and nothing else', () => {
    // Everything else a payload used to carry is world-scoped and now arrives
    // once via TM.GET_LABEL_CATALOGS. A payload that tried to contribute traits
    // would be a module out of step with this contract.
    const result = catalogsFromPayload(
      labelPayload({ rollOptionLabels: { 'PF2E.SpecificRule.Foo': 'Foo' } })
    )
    expect(result).toEqual({
      ...emptyLabelCatalogs(),
      rollOptions: { 'PF2E.SpecificRule.Foo': 'Foo' }
    })
  })

  it('reads a payload with no rule labels as an empty contribution', () => {
    expect(catalogsFromPayload(labelPayload())).toEqual(emptyLabelCatalogs())
  })
})

describe('mergeLabelCatalogs', () => {
  it('unions keys across contributions rather than replacing', () => {
    // Two actors' rule labels both belong in the world's map: the keys are i18n
    // keys, globally meaningful, and neither actor names all of them.
    const base = catalogs({ rollOptions: { a: 'Alpha' } })
    const next = mergeLabelCatalogs(base, catalogs({ rollOptions: { b: 'Beta' } }))
    expect(next.rollOptions).toEqual({ a: 'Alpha', b: 'Beta' })
  })

  it('lets a later contribution re-label an existing key', () => {
    const base = catalogs({ traits: { finesse: 'Finesse' } })
    const next = mergeLabelCatalogs(base, catalogs({ traits: { finesse: 'Finezza' } }))
    expect(next.traits.finesse).toBe('Finezza')
  })

  it('returns the SAME object when nothing new is contributed', () => {
    // Identity is the store's change detection. Every refresh re-sends the same
    // rule labels, and without this each one would invalidate every computed
    // reading a label and queue a database write that changes nothing.
    const base = catalogs({ traits: { finesse: 'Finesse' }, iwr: { fire: 'Fire' } })
    expect(mergeLabelCatalogs(base, catalogs({ traits: { finesse: 'Finesse' } }))).toBe(base)
    expect(mergeLabelCatalogs(base, emptyLabelCatalogs())).toBe(base)
  })

  it('returns a new object when any one of the five catalogs changes', () => {
    const base = catalogs({ traits: { finesse: 'Finesse' } })
    const next = mergeLabelCatalogs(base, catalogs({ languages: { common: 'Common' } }))
    expect(next).not.toBe(base)
    // …and carries the untouched catalogs through intact.
    expect(next.traits).toEqual({ finesse: 'Finesse' })
    expect(next.languages).toEqual({ common: 'Common' })
  })

  it('does not mutate the base it was given', () => {
    const base = catalogs({ traits: { finesse: 'Finesse' } })
    mergeLabelCatalogs(base, catalogs({ traits: { agile: 'Agile' } }))
    expect(base.traits).toEqual({ finesse: 'Finesse' })
  })
})
