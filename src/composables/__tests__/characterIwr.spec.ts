// @vitest-environment jsdom
// characterStats imports the i18n plugin, which reads localStorage at module load.
import { describe, it, expect } from 'vitest'
import type { Immunity, Weakness, Resistance } from '@7h3laughingman/pf2e-types'

import { makeIWRs } from '@/composables/character/characterStats'

// PF2e's types declare `exceptions` as required, but the app holds wire JSON
// rather than a live document, and source data omits the key entirely when an
// entry has none — `{"type":"curse"}` is what an immunity actually looks like.
// Mapping over it unguarded threw inside a computed, which took the whole sheet
// down to a blank page rather than degrading. 68 of 173 openable actors in a
// real world carry at least one such entry.
const asSet = (entries: unknown[]) => entries as (Immunity | Weakness | Resistance)[]

describe('makeIWRs', () => {
  it('survives an entry that omits exceptions', () => {
    const result = makeIWRs(asSet([{ type: 'curse' }]))
    expect(result).toEqual([
      { type: 'curse', label: 'curse', exceptions: undefined, definition: undefined, value: undefined }
    ])
  })

  it('still maps exceptions when they are present', () => {
    const result = makeIWRs(
      asSet([{ type: 'physical', value: 5, exceptions: ['cold-iron', { label: 'silver' }] }])
    )
    expect(result?.[0].exceptions).toEqual(['cold-iron', 'silver'])
    expect(result?.[0].value).toBe(5)
  })

  it('prefers a supplied label over the de-hyphenated type', () => {
    const result = makeIWRs(asSet([{ type: 'cold-iron', value: 5 }]), { 'cold-iron': 'Cold Iron' })
    expect(result?.[0].label).toBe('Cold Iron')
  })

  it('passes an absent set straight through', () => {
    expect(makeIWRs(undefined)).toBeUndefined()
  })
})
