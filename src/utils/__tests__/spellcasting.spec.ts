import { describe, it, expect } from 'vitest'
import type { Spell, SpellcastingEntry } from '@/composables/character'
import {
  isStrictPrepared,
  isFlexiblePrepared,
  isSlotCaster,
  isInnate,
  isFocusPool,
  makeSpellRankResolver,
  buildSpellbook,
  buildOrphanSpells,
  buildPrepList,
  hasAnySpells,
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
  autoHeightenLevel?: number
  slots?: Record<string, { max: number; prepared?: { id: string | null }[] }>
}): SpellcastingEntry {
  return {
    _id: overrides._id,
    name: overrides._id,
    type: 'spellcastingEntry',
    system: {
      prepared: { value: overrides.prepared, flexible: overrides.flexible },
      autoHeightenLevel: { value: overrides.autoHeightenLevel },
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
  focus?: boolean
  signature?: boolean
  heightenedLevel?: number
  autoHeightenLevel?: number
}): Spell {
  return {
    _id: overrides._id,
    name: overrides.name ?? overrides._id,
    type: 'spell',
    system: {
      location: {
        value: overrides.location,
        signature: overrides.signature,
        heightenedLevel: overrides.heightenedLevel,
        autoHeightenLevel: overrides.autoHeightenLevel
      },
      level: { value: overrides.level },
      traits: {
        value: [...(overrides.cantrip ? ['cantrip'] : []), ...(overrides.focus ? ['focus'] : [])]
      }
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

  it('classifies innate and focus entries, which spend per spell / per point', () => {
    const innate = makeEntry({ _id: 'e1', prepared: 'innate' })
    expect(isInnate(innate)).toBe(true)
    expect(isSlotCaster(innate)).toBe(false)
    expect(isStrictPrepared(innate)).toBe(false)

    const focus = makeEntry({ _id: 'e2', prepared: 'focus' })
    expect(isFocusPool(focus)).toBe(true)
    expect(isInnate(focus)).toBe(false)
  })

  it('handles undefined entries', () => {
    expect(isStrictPrepared(undefined)).toBe(false)
    expect(isFlexiblePrepared(undefined)).toBe(false)
    expect(isSlotCaster(undefined)).toBe(false)
    expect(isInnate(undefined)).toBe(false)
    expect(isFocusPool(undefined)).toBe(false)
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

// PF2e's real answer to "what rank is this spell?" is SpellPF2e#rank, a prototype
// getter that never survives the socket — system.level.value is only the BASE
// rank. The resolver mirrors the getter, and getting it wrong is not cosmetic:
// the group's rank is passed on as the casting rank for damage previews and
// damage rolls, so a spell filed too low also rolls its damage too low.
describe('makeSpellRankResolver', () => {
  const rankAt10 = makeSpellRankResolver(10)

  it('files cantrips at 0 — their cast rank auto-scales Foundry-side', () => {
    const cantrip = makeSpell({ _id: 'daze', location: 'e1', level: 1, cantrip: true })
    expect(rankAt10(cantrip)).toBe(0)
  })

  it('takes the heightened rank when a spell was heightened into a higher group', () => {
    const heightened = makeSpell({ _id: 'meta', location: 'e1', level: 6, heightenedLevel: 8 })
    expect(rankAt10(heightened)).toBe(8)
  })

  it('falls back to the base rank when nothing heightened it', () => {
    expect(rankAt10(makeSpell({ _id: 'dominate', location: 'e1', level: 6 }))).toBe(6)
  })

  it('auto-heightens a focus spell to half the caster level, rounded up', () => {
    const layOnHands = makeSpell({ _id: 'loh', location: 'e1', level: 1, focus: true })
    expect(rankAt10(layOnHands)).toBe(5)
    expect(makeSpellRankResolver(1)(layOnHands)).toBe(1)
    expect(makeSpellRankResolver(19)(layOnHands)).toBe(10)
  })

  it('auto-heightens every non-cantrip in a focus entry, trait or not', () => {
    const focusEntry = makeEntry({ _id: 'e1', prepared: 'focus' })
    const untagged = makeSpell({ _id: 'untagged', location: 'e1', level: 1 })
    expect(rankAt10(untagged, focusEntry)).toBe(5)
    expect(isFocusPool(focusEntry)).toBe(true)
  })

  it('prefers an explicit autoHeightenLevel over half the caster level', () => {
    const entry = makeEntry({ _id: 'e1', prepared: 'focus', autoHeightenLevel: 3 })
    const spell = makeSpell({ _id: 'loh', location: 'e1', level: 1, focus: true })
    expect(rankAt10(spell, entry)).toBe(3)
    // The spell's own override beats the entry's.
    const pinned = makeSpell({
      _id: 'pinned',
      location: 'e1',
      level: 1,
      focus: true,
      autoHeightenLevel: 7
    })
    expect(rankAt10(pinned, entry)).toBe(7)
  })

  it('floors at 1 and copes with an unknown caster level', () => {
    const focusSpell = makeSpell({ _id: 'loh', location: 'e1', level: 1, focus: true })
    expect(makeSpellRankResolver(undefined)(focusSpell)).toBe(1)
    expect(makeSpellRankResolver(0)(focusSpell)).toBe(1)
  })
})

describe('buildSpellbook — heightened and focus grouping', () => {
  it('files a heightened innate spell under its heightened rank', () => {
    const innate = makeEntry({ _id: 'e1', prepared: 'innate' })
    const meta = makeSpell({
      _id: 'meta',
      name: 'Cursed Metamorphosis',
      location: 'e1',
      level: 6,
      heightenedLevel: 8
    })
    const dominate = makeSpell({ _id: 'dominate', name: 'Dominate', location: 'e1', level: 6 })
    const book = buildSpellbook([innate], [meta, dominate], makeSpellRankResolver(12))
    expect(book.e1['8'].map((s) => s?.name)).toEqual(['Cursed Metamorphosis'])
    expect(book.e1['6'].map((s) => s?.name)).toEqual(['Dominate'])
  })

  it('files a focus spell at its auto-heightened rank, not its base rank', () => {
    const focus = makeEntry({ _id: 'e1', prepared: 'focus' })
    const loh = makeSpell({
      _id: 'loh',
      name: 'Lay on Hands',
      location: 'e1',
      level: 1,
      focus: true
    })
    const book = buildSpellbook([focus], [loh], makeSpellRankResolver(10))
    expect(book.e1['5'].map((s) => s?.name)).toEqual(['Lay on Hands'])
    expect(book.e1['1']).toEqual([])
  })

  it('leaves strict-prepared entries on their slot arrays, resolver or not', () => {
    const entry = makeEntry({
      _id: 'e1',
      prepared: 'prepared',
      slots: { slot1: { max: 2, prepared: [{ id: 'heal' }, { id: null }] } }
    })
    const heal = makeSpell({ _id: 'heal', location: 'e1', level: 1, heightenedLevel: 4 })
    const book = buildSpellbook([entry], [heal], makeSpellRankResolver(10))
    expect(book.e1['1'].map((s) => s?._id)).toEqual(['heal', undefined])
    expect(book.e1['4']).toEqual([])
  })

  it('sorts a heightened spell as native to its own group, not as a signature spell', () => {
    const innate = makeEntry({ _id: 'e1', prepared: 'innate' })
    const meta = makeSpell({
      _id: 'meta',
      name: 'Zed',
      location: 'e1',
      level: 6,
      heightenedLevel: 8
    })
    const native = makeSpell({ _id: 'native', name: 'Abc', location: 'e1', level: 8 })
    const book = buildSpellbook([innate], [meta, native], makeSpellRankResolver(12))
    // Both are native to rank 8; the stable sort keeps input order rather than
    // demoting the heightened one to the bottom.
    expect(book.e1['8'].map((s) => s?.name)).toEqual(['Zed', 'Abc'])
  })
})

// PF2e attaches a spell to an entry via system.location.value and its sheets only
// render entry collections, so an unattached spell is invisible there — a real
// content gap for bestiary rituals and one-off abilities.
describe('buildOrphanSpells', () => {
  const entry = makeEntry({ _id: 'e1', prepared: 'innate' })
  const attached = makeSpell({ _id: 'attached', name: 'Attached', location: 'e1', level: 3 })

  it('collects spells with no location at all', () => {
    const loose = makeSpell({ _id: 'weather', name: 'Control Weather', location: null!, level: 8 })
    const ranks = buildOrphanSpells([entry], [attached, loose])
    expect(ranks['8'].map((s) => s?.name)).toEqual(['Control Weather'])
    expect(
      Object.values(ranks)
        .flat()
        .map((s) => s?._id)
    ).not.toContain('attached')
  })

  it('collects spells pointing at an entry that no longer exists', () => {
    const stale = makeSpell({ _id: 'stale', name: 'Stale', location: 'deletedEntry', level: 2 })
    const ranks = buildOrphanSpells([entry], [stale])
    expect(ranks['2'].map((s) => s?.name)).toEqual(['Stale'])
  })

  it('groups by resolved rank and sorts by name within a rank', () => {
    const b = makeSpell({ _id: 'b', name: 'Beta', location: null!, level: 2 })
    const a = makeSpell({ _id: 'a', name: 'Alpha', location: null!, level: 2 })
    const cantrip = makeSpell({
      _id: 'c',
      name: 'Cantrip',
      location: null!,
      level: 1,
      cantrip: true
    })
    const ranks = buildOrphanSpells([entry], [b, a, cantrip], makeSpellRankResolver(10))
    expect(ranks['2'].map((s) => s?.name)).toEqual(['Alpha', 'Beta'])
    expect(ranks['0'].map((s) => s?.name)).toEqual(['Cantrip'])
  })

  it('reports emptiness so the caller can hide the section', () => {
    expect(hasAnySpells(buildOrphanSpells([entry], [attached]))).toBe(false)
    expect(hasAnySpells(buildOrphanSpells([entry], []))).toBe(false)
    expect(hasAnySpells(undefined)).toBe(false)
    const loose = makeSpell({ _id: 'loose', location: null!, level: 1 })
    expect(hasAnySpells(buildOrphanSpells([entry], [loose]))).toBe(true)
  })

  it('treats every spell as an orphan when there are no entries', () => {
    const ranks = buildOrphanSpells([], [attached])
    expect(ranks['3'].map((s) => s?._id)).toEqual(['attached'])
  })
})
