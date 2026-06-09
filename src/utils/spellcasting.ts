import type { Spell, SpellcastingEntry } from '@/composables/character'

// Slots are keyed slot0..slot10 (cantrips + ranks 1-10).
export const MAX_SPELL_RANK = 10
export const slotKey = (rank: number | string) => 'slot' + rank

// Spellcasting-entry preparation predicates. The prepared.value / flexible
// combination drives slot accounting and UI throughout, so the rules live here.
export const isStrictPrepared = (e?: SpellcastingEntry) =>
  e?.system?.prepared?.value === 'prepared' && e.system?.prepared?.flexible === false
export const isFlexiblePrepared = (e?: SpellcastingEntry) =>
  e?.system?.prepared?.value === 'prepared' && e.system?.prepared?.flexible === true
export const isSlotCaster = (e?: SpellcastingEntry) =>
  e?.system?.prepared?.value === 'spontaneous' || isFlexiblePrepared(e)

// A spellbook maps each spellcasting entry id to its ranks ('0'..'10'), and each
// rank to the spells shown there. Prepared entries use sparse arrays (undefined =
// an empty, fillable slot); other entries pack their spells densely.
export interface Spellbook {
  [entryId: string]: { [rank: string]: (Spell | undefined)[] }
}

function emptyRanks(): Spellbook[string] {
  return Object.fromEntries(
    Array.from({ length: MAX_SPELL_RANK + 1 }, (_, i): [string, (Spell | undefined)[]] => [
      String(i),
      []
    ])
  )
}

function preparedSlotRow(
  slot: SpellcastingEntry['system']['slots'][string] | undefined,
  spellById: Map<string | undefined, Spell>
) {
  return Array.from({ length: slot?.max ?? 0 }, (_, i) => {
    const id = slot?.prepared[i]?.id
    return id ? spellById.get(id) : undefined
  })
}

function fillPreparedSlots(
  spellbook: Spellbook,
  entry: SpellcastingEntry,
  spellById: Map<string | undefined, Spell>
) {
  const entryId = entry._id ?? ''
  for (let rank = 0; rank <= MAX_SPELL_RANK; rank++) {
    spellbook[entryId][rank] = preparedSlotRow(entry.system?.slots?.[slotKey(rank)], spellById)
  }
}

function addSpellToRank(
  spellbook: Spellbook,
  entry: SpellcastingEntry,
  spell: Spell,
  rank: number
) {
  if (rank < 0 || rank > MAX_SPELL_RANK) return
  spellbook[entry._id ?? '']?.[rank]?.push(spell)
}

function fillAndSortSpells(spellbook: Spellbook, entry: SpellcastingEntry, spells: Spell[]) {
  for (const spell of spells) {
    if (spell.type !== 'spell' || spell.system?.location?.value !== entry._id) continue

    const spellRank = spell.system?.traits?.value?.includes('cantrip')
      ? 0
      : (spell.system?.level?.value ?? 0)
    addSpellToRank(spellbook, entry, spell, spellRank)

    if (spell.system?.location?.signature) {
      for (let rank = spellRank + 1; rank <= MAX_SPELL_RANK; rank++) {
        if (entry.system?.slots?.[slotKey(rank)]?.max) addSpellToRank(spellbook, entry, spell, rank)
      }
    }
  }

  for (const [rankStr, rankSpells] of Object.entries(spellbook[entry._id ?? ''])) {
    const rank = Number(rankStr)
    rankSpells.sort((a, b) => {
      const aLevel = a?.system?.level?.value ?? NaN
      const bLevel = b?.system?.level?.value ?? NaN
      const aSignature = aLevel === rank ? 0 : 1
      const bSignature = bLevel === rank ? 0 : 1
      return aSignature - bSignature || aLevel - bLevel
    })
  }
}

export function buildSpellbook(
  entries: SpellcastingEntry[] | undefined,
  spells: Spell[] | undefined
): Spellbook {
  const spellbook: Spellbook = {}
  const allSpells = spells ?? []
  const spellById = new Map(allSpells.map((spell) => [spell._id, spell]))

  for (const entry of entries ?? []) {
    const entryId = entry._id ?? ''
    spellbook[entryId] = emptyRanks()
    if (isStrictPrepared(entry)) fillPreparedSlots(spellbook, entry, spellById)
    else fillAndSortSpells(spellbook, entry, allSpells)
  }

  return spellbook
}

// Context passed to the info modal when a spell/slot is opened, identifying which
// entry, rank and slot it came from (or that it is a staff/consumable cast).
export interface SpellInfo {
  entry?: SpellcastingEntry
  entryId?: string
  castingRank?: number
  castingSlot?: number
  isConsumable?: boolean
  fromStaff?: boolean
}
