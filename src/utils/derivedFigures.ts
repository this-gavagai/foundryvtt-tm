import type { Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'
import { derivationInputFor } from '@/composables/character/derivedStatistics'
import {
  deriveArmorClass,
  deriveFocusPool,
  deriveHitPointsMax,
  deriveIWR,
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
import { composeItemName } from '@/utils/itemName'
import { displayedValuation } from '@/utils/itemValuation'
import { displacedOverlays } from '@/utils/itemSource'
import { asDocumentArray } from '@/api/internal'
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

// A figure whose payload copy lives at one path and whose value is a number.
function atPath(
  actor: Ref<TablemateCharacter | undefined>,
  key: string,
  path: string,
  value: () => unknown
): Figure {
  return {
    key,
    value,
    reported: () => readAt(actor.value, path),
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
  const size = (a.system as { traits?: { size?: { value?: string } } } | undefined)?.traits?.size
    ?.value
  const strength = a.system?.abilities?.str?.mod ?? 0
  out.push(
    atPath(actor, 'inventory.bulk', 'inventory.bulk', () => {
      const bulk = inventoryBulk(items, strength, size)
      // The total is what a write moves; max and encumberedAfter follow Str.
      return `${bulk.value.value}|${bulk.max}|${bulk.encumberedAfter}`
    }),
    atPath(actor, 'inventory.containers', 'inventory.containers', () =>
      JSON.stringify(
        Object.fromEntries(
          items
            .filter((i) => i.type === 'backpack')
            .map((i) => [i._id, containerCapacity(i, items, size)?.value ?? 0])
        )
      )
    ),
    atPath(actor, 'inventory.labels', 'inventory.labels', () =>
      JSON.stringify(
        Object.fromEntries(
          items.map((i) => [
            i._id,
            composeItemName(i as never, undefined) ?? (i as { name?: string }).name
          ])
        )
      )
    )
  )

  // Item level and price are overlaid ONTO each item rather than sitting in one
  // block, so the figure is the whole set and clearing means restoring source.
  out.push({
    key: 'items.valuation',
    value: () =>
      JSON.stringify(
        items.map((i) => {
          const v = displayedValuation(i as never, [])
          return [i._id, v.level, v.price]
        })
      ),
    reported: () =>
      JSON.stringify(
        items.map((i) => {
          const v = displayedValuation(
            i as never,
            displacedOverlays(i as never).map((e) => e.path)
          )
          return [i._id, v.level, v.price]
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
    atPath(actor, 'ac', 'system.attributes.ac', () => deriveArmorClass(input).value),
    atPath(actor, 'hp.max', 'system.attributes.hp.max', () => deriveHitPointsMax(input).value),
    atPath(actor, 'perception', 'system.perception', () => derivePerception(input).value),
    atPath(actor, 'initiative', 'system.initiative.totalModifier', () => {
      const named = a.system?.initiative?.statistic ?? undefined
      const rank =
        named && named !== 'perception'
          ? ((a.system?.skills as Record<string, { rank?: number }> | undefined)?.[named]?.rank ??
            0)
          : 0
      return deriveInitiative(input, named, rank).value
    }),
    atPath(actor, 'focus.max', 'system.resources.focus.max', () => deriveFocusPool(input).max),
    atPath(actor, 'iwr', 'system.attributes.immunities', () => {
      const iwr = deriveIWR(input, a.system?.attributes)
      return JSON.stringify([iwr.immunities, iwr.weaknesses, iwr.resistances])
    })
  )
  for (const slug of Object.keys(a.system?.saves ?? {})) {
    out.push(
      atPath(actor, `save.${slug}`, `system.saves.${slug}`, () => deriveSave(input, slug).value)
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
        () => deriveSkill(input, slug, rank, { lore }).value
      )
    )
  }
  out.push(
    atPath(actor, 'movement', 'system.movement.speeds', () => {
      const speeds = deriveMovement(input)
      return MOVEMENT_TYPES.map((t) => `${t}:${speeds[t]?.value ?? ''}`).join('|')
    })
  )
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
