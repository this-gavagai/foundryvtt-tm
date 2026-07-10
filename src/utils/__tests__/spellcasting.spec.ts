import { describe, it, expect } from 'vitest'
import type { Spell, SpellcastingEntry } from '@/composables/character'
import {
  isStrictPrepared,
  isFlexiblePrepared,
  isSlotCaster,
  buildSpellbook,
  buildPrepList,
  MAX_SPELL_RANK
} from '@/utils/spellcasting'

// Slot accounting is the sheet's core spellcasting logic, and the
// prepared/flexible distinction is a documented trap: normal prepared entries
// OMIT system.prepared.flexible entirely, so anything matching on
// `flexible === false` silently misroutes clerics through the spontaneous
// path. These fixtures mirror the serialized entry/spell shapes.

function makeEntry(overrides: {
  _id: string
  prepared?: string
  flexible?: boolean
  slots?: Record<string, { max: number; prepared?: { id: string | null }[] }>
}): SpellcastingEntry {
  return {
    _id: overrides._id,
    name: overrides._id,
    type: 'spellcastingEntry',
    system: {
      prepared: { value: overrides.prepared, flexible: overrides.flexible },
      slots: Object.fromEntries(
        Object.entries(overrides.slots ?? {}).map(([key, slot]) => [
          key,
          { value: slot.max, max: slot.max, prepared: slot.prepared ?? [] }
        ])
      )
    }
  } as unknown as SpellcastingEntry
}

function makeSpell(overrides: {
  _id: string
  name?: string
  location: string
  level: number
  cantrip?: boolean
  signature?: boolean
}): Spell {
  return {
    _id: overrides._id,
    name: overrides.name ?? overrides._id,
    type: 'spell',
    system: {
      location: { value: overrides.location, signature: overrides.signature },
      level: { value: overrides.level },
      traits: { value: overrides.cantrip ? ['cantrip'] : [] }
    }
  } as unknown as Spell
}

describe('preparation predicates', () => {
  it('treats a prepared entry with NO flexible field as strict prepared (the cleric trap)', () => {
    const cleric = makeEntry({ _id: 'e1', prepared: 'prepared' })
    expect(cleric.system.prepared.flexible).toBeUndefined()
    expect(isStrictPrepared(cleric)).toBe(true)
    expect(isFlexiblePrepared(cleric)).toBe(false)
    expect(isSlotCaster(cleric)).toBe(false)
  })

  it('treats explicit flexible:false as strict prepared too', () => {
    const entry = makeEntry({ _id: 'e1', prepared: 'prepared', flexible: false })
    expect(isStrictPrepared(entry)).toBe(true)
  })

  it('classifies flexible and spontaneous entries as slot casters', () => {
    const flexible = makeEntry({ _id: 'e1', prepared: 'prepared', flexible: true })
    expect(isStrictPrepared(flexible)).toBe(false)
    expect(isFlexiblePrepared(flexible)).toBe(true)
    expect(isSlotCaster(flexible)).toBe(true)

    const sorcerer = makeEntry({ _id: 'e2', prepared: 'spontaneous' })
    expect(isSlotCaster(sorcerer)).toBe(true)
    expect(isStrictPrepared(sorcerer)).toBe(false)
  })

  it('handles undefined entries', () => {
    expect(isStrictPrepared(undefined)).toBe(false)
    expect(isFlexiblePrepared(undefined)).toBe(false)
    expect(isSlotCaster(undefined)).toBe(false)
  })
})

describe('buildSpellbook — strict prepared entries', () => {
  const heal = makeSpell({ _id: 'heal', location: 'e1', level: 1 })
  const bless = makeSpell({ _id: 'bless', location: 'e1', level: 1 })
  const entry = makeEntry({
    _id: 'e1',
    prepared: 'prepared',
    slots: {
      slot1: { max: 3, prepared: [{ id: 'heal' }, { id: null }, { id: 'bless' }] }
    }
  })

  it('maps prepared slot ids to spells, keeping empty slots as undefined', () => {
    const book = buildSpellbook([entry], [heal, bless])
    expect(book.e1['1']).toEqual([heal, undefined, bless])
  })

  it('sizes each rank row to the slot max even when nothing is prepared', () => {
    const empty = makeEntry({
      _id: 'e1',
      prepared: 'prepared',
      slots: { slot2: { max: 2 } }
    })
    const book = buildSpellbook([empty], [])
    expect(book.e1['2']).toEqual([undefined, undefined])
    expect(book.e1['1']).toEqual([])
  })

  it('leaves a prepared id pointing at a missing spell as an empty slot', () => {
    const book = buildSpellbook([entry], [heal])
    expect(book.e1['1']).toEqual([heal, undefined, undefined])
  })
})

describe('buildSpellbook — spontaneous entries', () => {
  const cantrip = makeSpell({ _id: 'daze', location: 'e2', level: 5, cantrip: true })
  const rankOne = makeSpell({ _id: 'magic-missile', location: 'e2', level: 1 })
  const signature = makeSpell({ _id: 'fear', location: 'e2', level: 1, signature: true })
  const rankThree = makeSpell({ _id: 'fireball', location: 'e2', level: 3 })
  const otherEntry = makeSpell({ _id: 'foreign', location: 'other', level: 1 })
  const entry = makeEntry({
    _id: 'e2',
    prepared: 'spontaneous',
    slots: {
      slot1: { max: 3 },
      slot2: { max: 3 },
      slot3: { max: 2 }
    }
  })

  const book = buildSpellbook([entry], [cantrip, rankOne, signature, rankThree, otherEntry])

  it('groups spells by rank, and cantrips at rank 0 regardless of their level', () => {
    expect(book.e2['0']).toEqual([cantrip])
    expect(book.e2['1'].map((s) => s?._id)).toEqual(['magic-missile', 'fear'])
  })

  it('ignores spells belonging to other entries', () => {
    expect(Object.values(book.e2).flat()).not.toContain(otherEntry)
  })

  it('heightens signature spells into every higher rank that has slots', () => {
    expect(book.e2['2'].map((s) => s?._id)).toEqual(['fear'])
    // Rank 3: the native-rank spell sorts before the heightened signature.
    expect(book.e2['3'].map((s) => s?._id)).toEqual(['fireball', 'fear'])
    // No slots above rank 3 → no heightened copies there.
    expect(book.e2['4']).toEqual([])
  })
})

describe('buildPrepList', () => {
  const heal = makeSpell({ _id: 'heal', name: 'Heal', location: 'e1', level: 1 })
  const bless = makeSpell({ _id: 'bless', name: 'Bless', location: 'e1', level: 1 })
  const guidance = makeSpell({
    _id: 'guidance',
    name: 'Guidance',
    location: 'e1',
    level: 1,
    cantrip: true
  })
  const prepared = makeEntry({ _id: 'e1', prepared: 'prepared' })
  const spontaneous = makeEntry({ _id: 'e2', prepared: 'spontaneous' })

  it('lists the known spells of prepared entries by base rank, sorted by name', () => {
    const prepList = buildPrepList([prepared, spontaneous], [heal, bless, guidance])
    expect(prepList.e1['0']).toEqual([guidance])
    expect(prepList.e1['1'].map((s) => s?.name)).toEqual(['Bless', 'Heal'])
  })

  it('includes flexible entries but not spontaneous ones', () => {
    const flexible = makeEntry({ _id: 'e3', prepared: 'prepared', flexible: true })
    const prepList = buildPrepList([prepared, spontaneous, flexible], [])
    expect(Object.keys(prepList)).toEqual(['e1', 'e3'])
  })

  it('drops spells outside the 0..MAX_SPELL_RANK range', () => {
    const tooHigh = makeSpell({ _id: 'wish+', location: 'e1', level: MAX_SPELL_RANK + 1 })
    const prepList = buildPrepList([prepared], [tooHigh])
    expect(Object.values(prepList.e1).flat()).toEqual([])
  })
})
