import type { Spell, SpellcastingEntry } from '@/composables/character'

// Slots are keyed slot0..slot10 (cantrips + ranks 1-10).
export const MAX_SPELL_RANK = 10
export const slotKey = (rank: number | string) => 'slot' + rank

// Spellcasting-entry preparation predicates. The prepared.value / flexible
// combination drives slot accounting and UI throughout, so the rules live here.
export const isStrictPrepared = (e?: SpellcastingEntry) =>
  e?.system.prepared.value === 'prepared' && e.system.prepared.flexible === false
export const isFlexiblePrepared = (e?: SpellcastingEntry) =>
  e?.system.prepared.value === 'prepared' && e.system.prepared.flexible === true
export const isSlotCaster = (e?: SpellcastingEntry) =>
  e?.system.prepared.value === 'spontaneous' || isFlexiblePrepared(e)

// A spellbook maps each spellcasting entry id to its ranks ('0'..'10'), and each
// rank to the spells shown there. Prepared entries use sparse arrays (undefined =
// an empty, fillable slot); other entries pack their spells densely.
export interface Spellbook {
  [entryId: string]: { [rank: string]: (Spell | undefined)[] }
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
