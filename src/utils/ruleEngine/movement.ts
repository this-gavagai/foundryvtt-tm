import { testPredicate, type PredicateStatement } from './predicate'
import { resolveValue, type ValueContext } from './resolveValue'
import {
  applyStacking,
  collectFlatModifiers,
  resolveStacking,
  type EngineItem,
  type EngineModifier
} from './flatModifiers'
import { sealLedger, type Ledger, type SkippedRule } from './ledger'
import type { RollOptionSet } from './rollOptions'
import { versionVerdict } from './index'

// Movement speeds.
//
// The last Tier 2 figure with real arithmetic behind it, and the one whose
// shape differs most from the check statistics. Three things make it its own
// module rather than another entry in statistics.ts:
//
//   1. The base is not on the actor at all. A world dump carries no
//      `system.movement` whatsoever — PF2e writes it during preparation from
//      the ANCESTRY item's `system.speed` (AncestryPF2e#prepareActorData), so
//      land speed is recovered the same way traits and size were.
//   2. The penalties are not rule elements. Armour speed penalty, shield speed
//      penalty and the `hindering` trait are constructed in code by
//      `CharacterPF2e#prepareMovementData` and injected as modifiers before any
//      rule element is consulted.
//   3. Every other speed is a rule element — `BaseSpeed` — and one of them can
//      be DERIVED FROM LAND, in which case it inherits land's total (penalties
//      already applied) rather than starting from its own base.
//
// PF2e's own order, reproduced: base = max(ancestry, every BaseSpeed for that
// type whose predicate passes), then value = max(0, base + modifiers).

export const MOVEMENT_TYPES = ['land', 'burrow', 'climb', 'fly', 'swim'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export interface DerivedSpeed {
  type: MovementType
  value: number
  base: number
  // The item that supplied the base — the ancestry for land, whichever feat or
  // effect granted the speed otherwise. PF2e shows this in its breakdown.
  source: string | null
  modifiers: EngineModifier[]
  ledger: Ledger
}

export interface MovementInput {
  items: readonly EngineItem[]
  strength: number
  options: RollOptionSet
  context: ValueContext
  stamp?: string
}

interface AncestrySystem {
  speed?: number
}

interface ArmorSystem {
  speedPenalty?: number
  strength?: number | null
  traits?: { value?: string[] }
  equipped?: { carryType?: string; inSlot?: boolean; handsHeld?: number }
  usage?: { value?: string }
}

interface BaseSpeedRule {
  key?: string
  selector?: string
  value?: unknown
  predicate?: PredicateStatement[]
  ignored?: boolean
  label?: string
  slug?: string
}

const modifier = (
  slug: string,
  label: string,
  value: number,
  source: string
): EngineModifier => ({
  slug,
  label,
  modifier: value,
  // Every speed penalty PF2e builds is untyped, so they all stack with each
  // other and with anything a rule element adds.
  type: 'untyped',
  enabled: true,
  hideIfDisabled: false,
  force: false,
  source
})

// PF2e's test for the worn armour, matching deriveArmorClass's.
function wornArmor(items: readonly EngineItem[]) {
  return items.find((item) => {
    if (item.type !== 'armor') return false
    const system = item.system as unknown as ArmorSystem
    return system.equipped?.carryType === 'worn' && system.equipped?.inSlot !== false
  })
}

// A shield counts only while actually held, so a shield in a pack imposes
// nothing. Kept deliberately narrow: `heldShield` in utils picks the BEST of
// several for a display readout, where this wants any that is being carried the
// way PF2e's `heldShield` getter means.
function heldShieldItem(items: readonly EngineItem[]) {
  return items.find((item) => {
    if (item.type !== 'shield') return false
    const system = item.system as unknown as ArmorSystem
    return system.equipped?.carryType === 'held' && (system.equipped?.handsHeld ?? 0) >= 1
  })
}

// The three modifiers `CharacterPF2e#prepareMovementData` builds by hand.
//
// The armour one has the only real arithmetic: meeting the armour's strength
// requirement reduces the penalty by 5, but never past zero, and the result is
// itself clamped at zero so a positive `speedPenalty` cannot become a bonus.
function constructedModifiers(
  items: readonly EngineItem[],
  strength: number,
  options: RollOptionSet
): { modifiers: EngineModifier[]; skipped: SkippedRule[] } {
  const modifiers: EngineModifier[] = []
  const skipped: SkippedRule[] = []

  const armor = wornArmor(items)
  const armorSystem = armor?.system as unknown as ArmorSystem | undefined
  const penalty = armorSystem?.speedPenalty ?? 0
  const requirement = armorSystem?.strength
  const eased =
    typeof requirement === 'number' && strength >= requirement
      ? Math.min(penalty + 5, 0)
      : penalty
  const armorPenalty = Math.min(eased, 0)
  if (armorPenalty) {
    // PF2e gates this on `nor: ['armor:ignore-speed-penalty']`, an option some
    // feats set. Unknown means the option family is one the engine cannot
    // decide, and a penalty silently dropped is exactly the direction that
    // flatters — so an unknown verdict is recorded and the penalty kept out.
    const verdict = testPredicate([{ nor: ['armor:ignore-speed-penalty'] }], options)
    if (verdict === 'true') {
      modifiers.push(
        modifier('armor-speed-penalty', armor?.name ?? 'Armor', armorPenalty, armor?.name ?? '')
      )
    } else if (verdict === 'unknown') {
      skipped.push({
        reason: 'unresolvable-predicate',
        key: 'ArmorSpeedPenalty',
        slug: 'armor-speed-penalty',
        itemName: armor?.name,
        detail: 'armor:ignore-speed-penalty'
      })
    }
  }

  const shield = heldShieldItem(items)
  const shieldPenalty = (shield?.system as unknown as ArmorSystem | undefined)?.speedPenalty ?? 0
  if (shieldPenalty) {
    const verdict = testPredicate([{ not: 'self:shield:ignore-speed-penalty' }], options)
    if (verdict === 'true') {
      modifiers.push(
        modifier('shield-speed-penalty', shield?.name ?? 'Shield', shieldPenalty, shield?.name ?? '')
      )
    } else if (verdict === 'unknown') {
      skipped.push({
        reason: 'unresolvable-predicate',
        key: 'ShieldSpeedPenalty',
        slug: 'shield-speed-penalty',
        itemName: shield?.name,
        detail: 'self:shield:ignore-speed-penalty'
      })
    }
  }

  // A flat -5 for the `hindering` trait, with no predicate at all.
  if (armorSystem?.traits?.value?.includes('hindering')) {
    modifiers.push(modifier('hindering', 'Hindering', -5, armor?.name ?? ''))
  }

  return { modifiers, skipped }
}

interface SpeedCandidate {
  value: number
  source: string | null
  // True when the rule's value reads land's own total. PF2e detects this
  // textually — `this.value.includes('movement.speeds.land.value')` — and such a
  // speed inherits land's modifiers instead of collecting its own.
  derivedFromLand: boolean
}

function baseSpeedRules(
  input: MovementInput,
  type: MovementType
): { candidates: SpeedCandidate[]; applied: number; skipped: SkippedRule[] } {
  const candidates: SpeedCandidate[] = []
  const skipped: SkippedRule[] = []
  let applied = 0

  for (const item of input.items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as BaseSpeedRule
      if (rule.key !== 'BaseSpeed' || rule.ignored) continue
      // PF2e trims a trailing `-speed`, so `land-speed` and `land` are one
      // selector.
      const selector = (rule.selector ?? '').trim().replace(/-speed$/, '')
      if (selector !== type) continue

      const verdict = testPredicate(rule.predicate, input.options)
      if (verdict === 'false') continue
      if (verdict === 'unknown') {
        skipped.push({
          reason: 'unresolvable-predicate',
          key: 'BaseSpeed',
          slug: rule.slug ?? selector,
          itemName: item.name,
          detail: JSON.stringify(rule.predicate).slice(0, 120)
        })
        continue
      }

      const derivedFromLand =
        type !== 'land' &&
        typeof rule.value === 'string' &&
        rule.value.includes('movement.speeds.land.value')
      // A land-derived speed cannot be resolved here: its value reads a figure
      // that does not exist until land is built. It is handled by the caller,
      // which has land's total in hand.
      if (derivedFromLand) {
        candidates.push({ value: 0, source: item.name ?? null, derivedFromLand: true })
        applied++
        continue
      }

      const resolved = resolveValue(rule.value, input.context)
      if (!resolved.ok) {
        skipped.push({
          reason: 'unresolvable-value',
          key: 'BaseSpeed',
          slug: rule.slug ?? selector,
          itemName: item.name,
          detail: resolved.reason
        })
        continue
      }
      // PF2e truncates and discards anything not above zero.
      const value = Math.trunc(Number(resolved.value))
      if (!(value > 0)) continue
      candidates.push({ value, source: item.name ?? null, derivedFromLand: false })
      applied++
    }
  }

  return { candidates, applied, skipped }
}

function speedDomains(type: MovementType): string[] {
  return ['all-speeds', 'speed', `${type}-speed`]
}

// Land, which everything else is measured against.
export function deriveLandSpeed(input: MovementInput): DerivedSpeed {
  const ancestry = input.items.find((item) => item.type === 'ancestry')?.system as
    | AncestrySystem
    | undefined
  const rules = baseSpeedRules(input, 'land')
  // PF2e reduces with `Math.max` over the ancestry's speed and every candidate,
  // so a BaseSpeed rule raises land but never lowers it.
  const base = [ancestry?.speed ?? 0, ...rules.candidates.map((c) => c.value)].reduce(
    (a, b) => Math.max(a, b),
    0
  )
  const built = constructedModifiers(input.items, input.strength, input.options)
  const collected = collectFlatModifiers(
    input.items,
    speedDomains('land'),
    input.options,
    input.context
  )
  const all = [...built.modifiers, ...collected.modifiers]
  return {
    type: 'land',
    base,
    // Never negative: PF2e clamps the total, not the modifiers, so a character
    // penalised past zero is immobile rather than moving backwards.
    value: Math.max(0, base + applyStacking(all)),
    source: ancestry ? (input.items.find((i) => i.type === 'ancestry')?.name ?? null) : null,
    modifiers: resolveStacking(all),
    ledger: sealLedger(
      {
        applied: rules.applied + collected.applied,
        skipped: [...built.skipped, ...rules.skipped, ...collected.skipped]
      },
      versionVerdict(input.stamp)
    )
  }
}

// Burrow, climb, fly and swim. Each exists only if something grants it, so
// `null` is the answer for a character with no such speed — distinct from a
// speed of zero, which PF2e also treats as absent.
export function deriveSpeed(
  input: MovementInput,
  type: MovementType,
  land: DerivedSpeed
): DerivedSpeed | null {
  if (type === 'land') return land
  const rules = baseSpeedRules(input, type)
  if (rules.candidates.length === 0) {
    // Nothing granted it — but a rule that COULD have was skipped, so the
    // honest answer is "no speed, and here is why that might be wrong" rather
    // than a confident absence.
    if (rules.skipped.length === 0) return null
    return {
      type,
      base: 0,
      value: 0,
      source: null,
      modifiers: [],
      ledger: sealLedger({ applied: 0, skipped: rules.skipped }, versionVerdict(input.stamp))
    }
  }

  // The highest wins. A land-derived candidate is worth land's own total, which
  // is why it could not be scored until now.
  const scored = rules.candidates.map((c) => ({
    ...c,
    value: c.derivedFromLand ? land.value : c.value
  }))
  const winner = scored.reduce((a, b) => (b.value > a.value ? b : a))

  // The one place the domains differ: PF2e's `Speed#extend` gives a land-derived
  // speed only its own `{type}-speed` domain, because land's total already
  // carries everything on `all-speeds` and `speed`. Collecting those again
  // would apply the armour penalty twice.
  const domains = winner.derivedFromLand ? [`${type}-speed`] : speedDomains(type)
  const collected = collectFlatModifiers(input.items, domains, input.options, input.context)
  const built = winner.derivedFromLand
    ? { modifiers: [] as EngineModifier[], skipped: [] as SkippedRule[] }
    : constructedModifiers(input.items, input.strength, input.options)
  const all = [...built.modifiers, ...collected.modifiers]

  return {
    type,
    base: winner.value,
    value: Math.max(0, winner.value + applyStacking(all)),
    source: winner.source,
    modifiers: resolveStacking(all),
    ledger: sealLedger(
      {
        applied: rules.applied + collected.applied,
        skipped: [...built.skipped, ...rules.skipped, ...collected.skipped]
      },
      versionVerdict(input.stamp)
    )
  }
}

// Every speed at once, which is what a sheet's movement panel wants.
export function deriveSpeeds(input: MovementInput): Record<MovementType, DerivedSpeed | null> {
  const land = deriveLandSpeed(input)
  const speeds = { land } as Record<MovementType, DerivedSpeed | null>
  for (const type of MOVEMENT_TYPES) {
    if (type === 'land') continue
    speeds[type] = deriveSpeed(input, type, land)
  }
  return speeds
}
