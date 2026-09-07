import type { Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'
import { derivationInputFor } from '@/composables/character/derivedStatistics'
import {
  deriveActorSize,
  deriveArmorClass,
  deriveFocusPool,
  deriveHitPointsMax,
  deriveInitiative,
  deriveMovement,
  derivePerception,
  deriveSave,
  deriveSkill,
  deriveSpellAttack,
  deriveSpellDC
} from '@/utils/ruleEngine/statistics'
import { MOVEMENT_TYPES } from '@/utils/ruleEngine/movement'
import { inventoryBulk, containerCapacity, type BulkItem } from '@/utils/bulk'
import { composeItemName, type NameableItem } from '@/utils/itemName'
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'
import { inventoryTypes } from '@/utils/constants'
import { displayedValuation } from '@/utils/itemValuation'
import { displacedOverlays } from '@/utils/itemSource'
import { asDocumentArray } from '@/api/internal'
import { logger } from '@/utils/utilities'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'

// Every figure the app can work out for itself, in one list.
//
// ONE MECHANISM, deliberately — no split by whether a figure is exact or
// estimated. That distinction is real and it is documented on the field audit,
// but building it into the architecture would mean deciding per field which
// values are allowed to win, forever, as the engine improves. The rule here does
// not need to know: a figure is preferred when OUR OWN CALCULATION HAS MOVED,
// which is the same question whatever the figure's pedigree.
//
// What that buys, in order of how much it matters:
//
//   1. A write lands and the numbers it affects move at once, rather than after
//      a getCharacterDetails round trip — or never, with no GM online.
//   2. A write that does NOT affect a figure leaves the payload's copy alone,
//      because the calculation does not move. No dependency tracking, no list of
//      what invalidates what: the calculation answers that by moving or not.
//   3. Every write becomes a PREDICTION. When the next payload lands, what PF2e
//      says can be compared against what we said it would say. That is a
//      stronger check than the differential harness makes today, which compares
//      the engine against the payload it arrived with — a figure can be right at
//      rest and wrong the moment armour is equipped, and only this notices.

export interface Figure {
  key: string
  // The app's own answer, or undefined when it cannot produce one.
  value: () => unknown
  // What the payload currently says, for the prediction comparison.
  reported: () => unknown
  // Drop the payload's copy, so the sheet's "prepared, else derived" reads fall
  // through to the calculation.
  clear: () => void
}

// A path like `system.attributes.ac`, deleted one level above the leaf so the
// parent object survives for its siblings.
function dropAt(root: unknown, path: string): void {
  const parts = path.split('.')
  let node = root as Record<string, unknown> | undefined
  for (const part of parts.slice(0, -1)) {
    node = node?.[part] as Record<string, unknown> | undefined
    if (!node || typeof node !== 'object') return
  }
  if (!node) return
  delete node[parts[parts.length - 1]]
}

function readAt(root: unknown, path: string): unknown {
  let node: unknown = root
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

// BOTH SIDES OF A COMPARISON GO THROUGH ONE FUNCTION.
//
// This is the load-bearing rule of the file, and it is not self-evident. A
// figure states what we think a value is and what the payload says it is, and
// the prediction check compares the two — so a figure whose two sides render the
// same world DIFFERENTLY reports a miss on every payload forever, whatever the
// numbers say. Six figures did exactly that. Our bulk said `4.4|10|5` against a
// payload object; our container map held Bulk instances against PF2e's capacity
// records; our label map covered every item where the payload names only
// physical ones; our prices omitted the denominations they did not use where
// PF2e's fill all four with zeros. The numbers agreed in every case. The shapes
// did not, so all of it read as the engine being wrong.
//
// The normalisers below are therefore SHARED: `reported()` runs the payload
// through the same function `value()` runs our own answer through, and a shape
// can no longer drift on one side alone.

// Bulk arithmetic runs through tenths, so two routes to one answer can differ in
// the last float place. Two decimals is finer than any Bulk value.
const round2 = (n: number | undefined): number => Math.round((n ?? 0) * 100) / 100

const bulkTotals = (
  bulk: { value?: { value?: number }; max?: number; encumberedAfter?: number } | undefined
): string | undefined =>
  bulk ? `${round2(bulk.value?.value)}|${bulk.max ?? 0}|${bulk.encumberedAfter ?? 0}` : undefined

// Sorted by id, because key order is a serialisation detail on both sides and
// two records that differ only in it hold the same containers.
const containerTotals = (
  containers: Record<string, { value?: number } | undefined> | undefined
): string =>
  JSON.stringify(
    Object.entries(containers ?? {})
      .map(([id, held]) => [id, round2(held?.value)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
  )

// A coin record from the world dump carries only the denominations it uses;
// PF2e's prepared copy fills all four. Same money either way.
const coins = (price: unknown): string => {
  const c = (price ?? {}) as Record<string, number | undefined>
  return `${c.pp ?? 0}|${c.gp ?? 0}|${c.sp ?? 0}|${c.cp ?? 0}`
}

const speedTotals = (
  speeds: Record<string, { value?: number } | null | undefined> | undefined
): string => MOVEMENT_TYPES.map((t) => `${t}:${speeds?.[t]?.value ?? ''}`).join('|')

// The world's rune, material and grade names, which is what turns a stored
// "Dagger" into the "+2 Greater Striking Dagger" PF2e reports. Passing
// `undefined` here — as this once did — makes composeItemName hand back the
// stored name untouched, so the figure predicted the wrong name on every item
// with a rune, on every payload. Pinia is active wherever the sheet is, but this
// table is also built from tests, so a missing store costs the composed name
// rather than the whole list.
// Said once per session, because declining quietly would trade a wrong answer
// for no answer AND no explanation. The stamp cannot catch this on its own: it
// is `system@version|locale|moduleVersion`, and a development build's version
// does not change when the module's catalog contents do — so a client running
// an older module publishes a catalog that says it is current and is not.
let announcedMissingNames = false

function itemNameCatalog(): Record<string, string> | undefined {
  try {
    const names = useLabelCatalogsStore().catalogs.itemNames
    // An EMPTY catalog is an unpublished one, not a world without runes in it:
    // the module publishes the whole system's base types and rune names, or
    // none of them. Treated as absent so the figure declines rather than
    // composing from nothing.
    if (names && Object.keys(names).length > 0) return names
    if (!announcedMissingNames) {
      announcedMissingNames = true
      logger.info(
        'TM: no item-name catalog published — items will show their stored names ' +
          'rather than composed ones (a rune-bearing weapon as "Dagger" rather than ' +
          '"+2 Greater Striking Dagger"). A Foundry client needs to reload for the ' +
          'module to publish it.'
      )
    }
    return undefined
  } catch {
    return undefined
  }
}

const NAMED_ITEM_TYPES = new Set(inventoryTypes.map((t) => t.type))

// A figure whose payload copy lives at one path and whose value is a number.
//
// `read` is where the payload keeps the number this figure predicts, which is
// not always `path` itself: PF2e's AC object carries BOTH `value` (21) and
// `totalModifier` (11 — the same AC without its base 10), and only `value` is
// the AC. Guessing between them by key name is what made AC miss on every
// payload. `clear` still drops all of `path`, so a stale breakdown cannot
// outlive the total that explains it.
function atPath(
  actor: Ref<TablemateCharacter | undefined>,
  key: string,
  path: string,
  value: () => unknown,
  read: string = path
): Figure {
  return {
    key,
    value,
    reported: () => readAt(actor.value, read),
    clear: () => dropAt(actor.value, path)
  }
}

export function derivableFigures(
  actor: Ref<TablemateCharacter | undefined>,
  stamp: string | undefined
): Figure[] {
  const a = actor.value
  if (!a) return []
  const out: Figure[] = []
  const items = (asDocumentArray(a.items) ?? []) as BulkItem[]
  const engineItems = items as unknown as EngineItem[]
  const input = derivationInputFor(actor, stamp)

  // ── Inventory: no rule-element surface, so these reproduce PF2e exactly.
  //
  // Size falls back to the ANCESTRY's, because `system.traits` is absent from a
  // world dump entirely — PF2e assembles it during preparation. Read from the
  // payload alone, a Small or Large character's Bulk limits and every
  // size-converted item Bulk were computed as Medium with no GM online, which
  // is a wrong number rather than a missing one. `deriveActorSize` already
  // answered this and nothing called it.
  const size =
    (a.system as { traits?: { size?: { value?: string } } } | undefined)?.traits?.size?.value ??
    deriveActorSize(engineItems)
  const strength = a.system?.abilities?.str?.mod ?? 0
  const named = items.filter((i) => NAMED_ITEM_TYPES.has(i.type ?? ''))
  const parts = itemNameCatalog()
  out.push(
    {
      key: 'inventory.bulk',
      // The total is what a write moves; max and encumberedAfter follow Str.
      value: () => bulkTotals(inventoryBulk(items, strength, size)),
      reported: () => bulkTotals(readAt(a, 'inventory.bulk') as never),
      clear: () => dropAt(a, 'inventory.bulk')
    },
    {
      key: 'inventory.containers',
      value: () =>
        containerTotals(
          Object.fromEntries(
            items
              .filter((i) => i.type === 'backpack')
              .map((i) => [i._id, { value: containerCapacity(i, items, size)?.value?.value }])
          )
        ),
      reported: () => containerTotals(readAt(a, 'inventory.containers') as never),
      clear: () => dropAt(a, 'inventory.containers')
    },
    {
      key: 'inventory.labels',
      // Physical items only, and in our own order, on both sides: the payload
      // names inventory types and their subitems, we name what we can compose,
      // and a comparison across two different sets of items is not a comparison.
      //
      // NO CATALOG, NO ANSWER. Without the world's rune and material names
      // composeItemName hands back the item's STORED name, and that is not our
      // answer to this question — it is the absence of one, and PF2e's is
      // better. So the figure declines: `undefined` leaves the payload
      // canonical and makes no prediction, where composing from nothing
      // predicted "Dagger" against PF2e's "+2 Greater Striking Dagger" on every
      // payload. The catalog is published by the Foundry module at `ready`, so
      // it is missing exactly when that client has not reloaded since the module
      // last changed — something to fix over there, not a divergence to report
      // here.
      value: () =>
        parts &&
        JSON.stringify(named.map((i) => [i._id, composeItemName(i as NameableItem, parts)])),
      reported: () => {
        const labels = readAt(a, 'inventory.labels') as Record<string, string> | undefined
        return labels && JSON.stringify(named.map((i) => [i._id, labels[i._id ?? '']]))
      },
      clear: () => dropAt(a, 'inventory.labels')
    }
  )

  // Item level and price are overlaid ONTO each item rather than sitting in one
  // block, so the figure is the whole set and clearing means restoring source.
  out.push({
    key: 'items.valuation',
    value: () =>
      JSON.stringify(
        items.map((i) => {
          const v = displayedValuation(i as never, [])
          return [i._id, v.level ?? null, coins(v.price)]
        })
      ),
    reported: () =>
      JSON.stringify(
        items.map((i) => {
          const v = displayedValuation(
            i as never,
            displacedOverlays(i as never).map((e) => e.path)
          )
          return [i._id, v.level ?? null, coins(v.price)]
        })
      ),
    // Clearing means dropping the overlay records, which is what makes
    // displayedValuation recompute rather than defer.
    clear: () => {
      for (const item of items) {
        const flags = (item as { flags?: { tablemate?: Record<string, unknown> } }).flags
        if (flags?.tablemate) delete flags.tablemate.derived
      }
    }
  })

  if (!input) return out

  // ── Statistics. Estimated rather than exact — they derive through the rule
  // engine and can be short a rule element it cannot see — and treated
  // identically anyway, which is the point of having one mechanism.
  out.push(
    atPath(
      actor,
      'ac',
      'system.attributes.ac',
      () => deriveArmorClass(input).value,
      'system.attributes.ac.value'
    ),
    atPath(actor, 'hp.max', 'system.attributes.hp.max', () => deriveHitPointsMax(input).value),
    atPath(
      actor,
      'perception',
      'system.perception',
      () => derivePerception(input).value,
      'system.perception.value'
    ),
    atPath(actor, 'initiative', 'system.initiative.totalModifier', () => {
      const named = a.system?.initiative?.statistic ?? undefined
      const rank =
        named && named !== 'perception'
          ? ((a.system?.skills as Record<string, { rank?: number }> | undefined)?.[named]?.rank ??
            0)
          : 0
      return deriveInitiative(input, named, rank).value
    }),
    atPath(actor, 'focus.max', 'system.resources.focus.max', () => deriveFocusPool(input).max)
    // NO IWR FIGURE, deliberately. The payload carries no derived immunities,
    // weaknesses or resistances — `system.attributes.{immunities,...}` is the
    // STORED list straight off the world dump, which is the seed our own
    // derivation starts from rather than an independent answer to compare
    // against. And the sheet already prefers the derivation unconditionally
    // (characterStats.ts), so there is no payload copy to invalidate either.
    // A figure here compared a derived list against its own input and reported
    // a miss for every rule element that had done its job.
  )
  for (const slug of Object.keys(a.system?.saves ?? {})) {
    out.push(
      atPath(
        actor,
        `save.${slug}`,
        `system.saves.${slug}`,
        () => deriveSave(input, slug).value,
        `system.saves.${slug}.value`
      )
    )
  }
  for (const [slug, skill] of Object.entries(a.system?.skills ?? {})) {
    const rank = (skill as { rank?: number; lore?: boolean } | undefined)?.rank ?? 0
    const lore = !!(skill as { lore?: boolean } | undefined)?.lore
    out.push(
      atPath(
        actor,
        `skill.${slug}`,
        `system.skills.${slug}`,
        () => deriveSkill(input, slug, rank, { lore }).value,
        `system.skills.${slug}.value`
      )
    )
  }
  out.push({
    key: 'movement',
    value: () => speedTotals(deriveMovement(input) as never),
    reported: () => speedTotals(readAt(a, 'system.movement.speeds') as never),
    clear: () => dropAt(a, 'system.movement.speeds')
  })
  for (const entry of engineItems.filter((i) => i.type === 'spellcastingEntry')) {
    const id = (entry as { _id?: string })._id
    if (!id) continue
    out.push({
      key: `spellcasting.${id}`,
      value: () => `${deriveSpellDC(input, entry).value}|${deriveSpellAttack(input, entry).value}`,
      reported: () => {
        const reported = (
          a as { spellcastingModifiers?: Record<string, { dc?: number; mod?: number }> }
        ).spellcastingModifiers?.[id]
        return reported ? `${reported.dc}|${reported.mod}` : undefined
      },
      clear: () => {
        const all = (a as { spellcastingModifiers?: Record<string, unknown> }).spellcastingModifiers
        if (all) delete all[id]
      }
    })
  }
  return out
}
