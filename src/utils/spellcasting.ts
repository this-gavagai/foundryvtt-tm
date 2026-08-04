import type { Spell, SpellcastingEntry } from '@/composables/character'

// Slots are keyed slot0..slot10 (cantrips + ranks 1-10).
export const MAX_SPELL_RANK = 10
export const slotKey = (rank: number | string) => 'slot' + rank

// Spellcasting-entry preparation predicates. The prepared.value / flexible
// combination drives slot accounting and UI throughout, so the rules live here.
// `flexible` is optional in the data and omitted for normal prepared casters
// (e.g. clerics) — only an explicit `true` makes an entry flexible, so anything
// that isn't flexible-true is strict prepared. Matching on `=== false` here
// would misclassify entries with no `flexible` field as non-prepared, routing
// them through the spontaneous/sorted path (wrong slot indices, no prep list).
export const isStrictPrepared = (e?: SpellcastingEntry) =>
  e?.system.prepared?.value === 'prepared' && e.system.prepared?.flexible !== true
export const isFlexiblePrepared = (e?: SpellcastingEntry) =>
  e?.system.prepared?.value === 'prepared' && e.system.prepared?.flexible === true
export const isSlotCaster = (e?: SpellcastingEntry) =>
  e?.system.prepared?.value === 'spontaneous' || isFlexiblePrepared(e)
export const isInnate = (e?: SpellcastingEntry) => e?.system.prepared?.value === 'innate'
export const isFocusPool = (e?: SpellcastingEntry) => e?.system.prepared?.value === 'focus'

const isCantrip = (spell: Spell) => !!spell.system.traits?.value?.includes('cantrip')
// PF2e's SpellPF2e#isFocusSpell. The traditions check catches focus cantrips,
// which the wire payload doesn't carry a traditions list for — the `focus` trait
// covers every non-cantrip focus spell, which is what auto-scaling hinges on.
const isFocusSpell = (spell: Spell) => !!spell.system.traits?.value?.includes('focus')

// Which rank a spell is listed under, and cast at, within an entry.
//
// `system.level.value` is only the spell's BASE rank. PF2e's real answer lives in
// `SpellPF2e#rank`, a prototype getter that can't survive the socket, so this
// mirrors it:
//   - cantrips group at 0 (the UI's cantrip row) but auto-scale when cast;
//   - focus spells and cantrips auto-heighten to the entry's autoHeightenLevel,
//     else half the caster's level rounded up;
//   - everything else takes `location.heightenedLevel` when a spell was
//     deliberately heightened into a higher group, else its base rank.
//
// Getting this wrong doesn't just misfile a row: the rank is passed through as
// `castingRank` for damage previews and damage rolls, so a spell filed too low
// also rolls its damage too low.
export type SpellRankResolver = (spell: Spell, entry?: SpellcastingEntry) => number

// Half level rounded up, floored at 1 — PF2e's `maxCantripRank`.
const autoHeightenRank = (spell: Spell, entry: SpellcastingEntry | undefined, level?: number) =>
  spell.system.location?.autoHeightenLevel ??
  entry?.system.autoHeightenLevel?.value ??
  Math.max(1, Math.ceil((level ?? 1) / 2))

export function makeSpellRankResolver(actorLevel?: number): SpellRankResolver {
  return (spell, entry) => {
    if (isCantrip(spell)) return 0
    if (isFocusSpell(spell) || isFocusPool(entry)) {
      return autoHeightenRank(spell, entry, actorLevel)
    }
    return spell.system.location?.heightenedLevel ?? spell.system.level?.value ?? 0
  }
}

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
    spellbook[entryId][rank] = preparedSlotRow(entry.system.slots?.[slotKey(rank)], spellById)
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

function fillAndSortSpells(
  spellbook: Spellbook,
  entry: SpellcastingEntry,
  spells: Spell[],
  rankOf: SpellRankResolver
) {
  for (const spell of spells) {
    if (spell.type !== 'spell' || spell.system.location?.value !== entry._id) continue

    const spellRank = rankOf(spell, entry)
    addSpellToRank(spellbook, entry, spell, spellRank)

    if (spell.system.location?.signature) {
      for (let rank = spellRank + 1; rank <= MAX_SPELL_RANK; rank++) {
        if (entry.system.slots?.[slotKey(rank)]?.max) addSpellToRank(spellbook, entry, spell, rank)
      }
    }
  }

  // Spells shown outside their own rank (a spontaneous caster's signature spells,
  // heightened into higher groups) sort after the ones native to the group.
  // Compare against the same resolver the filing used, or a heightened spell
  // would read as a signature spell in its own group.
  for (const [rankStr, rankSpells] of Object.entries(spellbook[entry._id ?? ''])) {
    const rank = Number(rankStr)
    rankSpells.sort((a, b) => {
      const aLevel = a ? rankOf(a, entry) : NaN
      const bLevel = b ? rankOf(b, entry) : NaN
      const aSignature = aLevel === rank ? 0 : 1
      const bSignature = bLevel === rank ? 0 : 1
      return aSignature - bSignature || aLevel - bLevel
    })
  }
}

// Spells that belong to no spellcasting entry, grouped by rank the same way an
// entry's spells are.
//
// PF2e attaches a spell to an entry through `system.location.value`, and its own
// sheets only ever render an entry's collection — so a spell whose location is
// null, or points at an entry that no longer exists, is invisible there. That's
// a real content gap rather than a curiosity: roughly one bestiary spell in forty
// is unattached (rituals and one-off "cast at will" abilities, mostly), and a GM
// reading a stat block needs to see them.
//
// They can be read and rolled but not *cast*: PF2e's cast path runs through
// SpellcastingEntry#cast, so there is nothing to cast them from. The caller
// omits the cast affordance rather than offering one that fails.
export function buildOrphanSpells(
  entries: SpellcastingEntry[] | undefined,
  spells: Spell[] | undefined,
  rankOf: SpellRankResolver = makeSpellRankResolver()
): Spellbook[string] {
  const entryIds = new Set((entries ?? []).map((entry) => entry._id))
  const ranks = emptyRanks()
  for (const spell of spells ?? []) {
    if (spell.type !== 'spell') continue
    const location = spell.system.location?.value
    if (location && entryIds.has(location)) continue
    const rank = rankOf(spell, undefined)
    if (rank >= 0 && rank <= MAX_SPELL_RANK) ranks[String(rank)].push(spell)
  }
  for (const rankSpells of Object.values(ranks)) {
    rankSpells.sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? ''))
  }
  return ranks
}

export const hasAnySpells = (ranks: Spellbook[string] | undefined) =>
  Object.values(ranks ?? {}).some((rankSpells) => rankSpells.length > 0)

// Returns all spells belonging to prepared entries, grouped by base rank.
// Used to display the "spell list" (what can be prepared) separately from active
// slots. Base rank on purpose — this is what the caster *knows* and may prepare,
// which PF2e's own #getSpellPrepList also keys on `spell.baseRank`.
export function buildPrepList(
  entries: SpellcastingEntry[] | undefined,
  spells: Spell[] | undefined
): Spellbook {
  const prepList: Spellbook = {}
  const allSpells = spells ?? []

  for (const entry of entries ?? []) {
    if (!isStrictPrepared(entry) && !isFlexiblePrepared(entry)) continue
    const entryId = entry._id ?? ''
    prepList[entryId] = emptyRanks()
    for (const spell of allSpells) {
      if (spell.type !== 'spell' || spell.system.location?.value !== entryId) continue
      const rank = spell.system.traits?.value?.includes('cantrip')
        ? 0
        : (spell.system.level?.value ?? 0)
      if (rank >= 0 && rank <= MAX_SPELL_RANK) {
        prepList[entryId][String(rank)].push(spell)
      }
    }
    for (const rankSpells of Object.values(prepList[entryId])) {
      rankSpells.sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? ''))
    }
  }

  return prepList
}

// `rankOf` decides which rank a non-prepared entry's spells are filed under —
// pass makeSpellRankResolver(actorLevel) so focus and heightened spells land
// where PF2e puts them. Strict-prepared entries ignore it entirely: their ranks
// come from the slot arrays.
export function buildSpellbook(
  entries: SpellcastingEntry[] | undefined,
  spells: Spell[] | undefined,
  rankOf: SpellRankResolver = makeSpellRankResolver()
): Spellbook {
  const spellbook: Spellbook = {}
  const allSpells = spells ?? []
  const spellById = new Map(allSpells.map((spell) => [spell._id, spell]))

  for (const entry of entries ?? []) {
    const entryId = entry._id ?? ''
    spellbook[entryId] = emptyRanks()
    if (isStrictPrepared(entry)) fillPreparedSlots(spellbook, entry, spellById)
    else fillAndSortSpells(spellbook, entry, allSpells, rankOf)
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
  // Belongs to no spellcasting entry (see buildOrphanSpells), so it can be read
  // and rolled but not cast.
  unattached?: boolean
}
