import { describe, it, expect } from 'vitest'
import { mergeDocumentChange } from '@/api/internal'

// Foundry deletes a key by sending `-=<key>: null` in the object that holds it,
// and echoes the same form to every other client. lodash has no notion of that,
// so a plain merge installed a literal property called `-=<key>` and left the
// original where it was: the deletion never happened, and a phantom key sat in
// the mirror until a full refresh replaced the document.
//
// That single gap is why the chat annotation flags are stored as flat arrays
// rather than as maps — an array always resets as a unit, so it sidesteps a
// merge that could not express a removal.

describe('key deletions', () => {
  it('removes the key a `-=` entry names', () => {
    const target = { flags: { pf2e: { grantedBy: { id: 'x' }, other: 1 } } }
    mergeDocumentChange(target, { flags: { pf2e: { '-=grantedBy': null } } })
    expect(target.flags.pf2e).toEqual({ other: 1 })
  })

  it('leaves no literal `-=` property behind', () => {
    const target: Record<string, unknown> = { a: 1 }
    mergeDocumentChange(target, { '-=a': null })
    expect(Object.keys(target)).toEqual([])
  })

  it('deletes and merges in the same change', () => {
    const target = { system: { slug: 'dying', value: { value: 2 }, stale: true } }
    mergeDocumentChange(target, { system: { value: { value: 3 }, '-=stale': null } })
    expect(target.system).toEqual({ slug: 'dying', value: { value: 3 } })
  })

  it('ignores a deletion for a key that is already gone', () => {
    const target = { flags: { tablemate: {} } }
    expect(() =>
      mergeDocumentChange(target, { flags: { tablemate: { '-=nope': null } } })
    ).not.toThrow()
    expect(target.flags.tablemate).toEqual({})
  })

  // The map shape this unblocks: one reaction row per message, removed by id
  // when its last emoji goes. Under the old merge this left `-=msg-2` sitting
  // beside the row it was supposed to remove.
  it('removes one row of a keyed map without touching its neighbours', () => {
    const target = { flags: { tablemate: { reactions: { 'msg-1': ['👍'], 'msg-2': ['🎲'] } } } }
    mergeDocumentChange(target, { flags: { tablemate: { reactions: { '-=msg-2': null } } } })
    expect(target.flags.tablemate.reactions).toEqual({ 'msg-1': ['👍'] })
  })

  it('does not treat a `-=` string VALUE as a deletion', () => {
    const target: Record<string, unknown> = {}
    mergeDocumentChange(target, { label: '-=not a key' })
    expect(target).toEqual({ label: '-=not a key' })
  })
})

describe('everything the merge already did', () => {
  it('replaces arrays wholesale rather than merging by position', () => {
    const target = { system: { traits: ['agile', 'finesse'] } }
    mergeDocumentChange(target, { system: { traits: ['deadly'] } })
    expect(target.system.traits).toEqual(['deadly'])
  })

  it('deep-merges plain objects', () => {
    const target = { system: { hp: { value: 10, max: 20 } } }
    mergeDocumentChange(target, { system: { hp: { value: 4 } } })
    expect(target.system.hp).toEqual({ value: 4, max: 20 })
  })

  it('does not descend into array elements looking for deletions', () => {
    const target = { rules: [{ key: 'RollOption', value: false }] }
    mergeDocumentChange(target, { rules: [{ key: 'RollOption', '-=value': null }] })
    // The array is replaced as a unit, so the `-=` rides along untouched rather
    // than being interpreted — which is what "arrays are authoritative" means.
    expect(target.rules).toEqual([{ key: 'RollOption', '-=value': null }])
  })

  it('returns the same object it mutated', () => {
    const target = { a: 1 }
    expect(mergeDocumentChange(target, { b: 2 })).toBe(target)
  })
})
