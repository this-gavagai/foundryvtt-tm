import { testPredicate, type PredicateStatement } from './predicate'
import { resolveValue, type ValueContext } from './resolveValue'
import { asRolled, asPersistent, type RollOptionSet } from './rollOptions'
import { emptyLedger, type ConditionalModifier, type SkippedRule } from './ledger'

// Collect the FlatModifier rule elements that reach a set of domains.
//
// FlatModifier is roughly 70% of the rule elements in PF2e's own compendium and
// close to all of the ones that move a defence or a check total, which is why it
// is the only type implemented. Every other `key` is counted as unsupported
// rather than ignored — a rule the engine cannot read is exactly as important to
// report as one it read and could not resolve.

export interface EngineModifier {
  slug: string
  label: string
  modifier: number
  type: string
  enabled: boolean
  hideIfDisabled: boolean
  // Whether the modifier is exempt from stacking, per PF2e's `force`.
  force: boolean
  source: string
}

export interface EngineItem {
  name?: string
  type?: string
  // Top-level, not under `system` — which is where `{item|flags…}` injections
  // read from, and where PF2e records a ChoiceSet's selection.
  flags?: Record<string, unknown>
  system?: {
    slug?: string | null
    rules?: unknown[]
    equipped?: { carryType?: string; handsHeld?: number; invested?: boolean | null }
    badge?: { value?: number }
  }
}

interface FlatModifierRule {
  key?: string
  selector?: string | string[]
  value?: unknown
  type?: string
  slug?: string
  label?: string
  predicate?: PredicateStatement[]
  min?: number
  max?: number
  hideIfDisabled?: boolean
  force?: boolean
  ignored?: boolean
  requiresEquipped?: boolean
  requiresInvestment?: boolean
  // A damage modifier, not a check or defence one — outside this engine's remit.
  damageType?: string
  battleForm?: boolean
}

// Rule elements that never contribute a modifier, and so are not gaps in a
// number even when they name a domain the caller cares about.
//
// `Note` attaches text to a roll; `AdjustDegreeOfSuccess` shifts an outcome
// band. Neither changes a total by so much as a point. Counting them made
// figures read provisional when the engine had missed nothing that affects the
// number — on one live character they were 46 of 115 recorded skips, drowning
// the four that mattered.
const NEVER_AFFECTS_A_TOTAL = new Set([
  'Note',
  'AdjustDegreeOfSuccess',
  'RollTwice',
  'SubstituteRoll'
])

// PF2e's own `sluggify`, in the part that matters here: apostrophes are
// DELETED, not turned into a separator, so "Mage's Hat" is `mages-hat` and not
// `mage-s-hat`. Everything else non-alphanumeric becomes a hyphen.
//
// Not cosmetic. A modifier's slug is its identity: the harness matches the
// engine's list against PF2e's by slug, and the roll path sends
// `modifierOverrides` keyed by slug when a player toggles one off. A slug that
// disagrees with PF2e's reads as a modifier PF2e never applied, and a toggle
// against it would silently fail to bind. Three items on the live table hit
// this — a Mage's Hat, a Crafter's Eyepiece and Healer's Gloves.
const sluggify = (input: string) =>
  input
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// PF2e's own equipped/invested gates. Both read stored fields, so they are
// answerable — except `invested`, which is `null` on an item that cannot be
// invested at all and would read as "not invested" if treated as a boolean.
function requirementMet(rule: FlatModifierRule, item: EngineItem): 'yes' | 'no' | 'unknown' {
  if (rule.requiresEquipped) {
    const carry = item.system?.equipped?.carryType
    if (carry === undefined) return 'unknown'
    if (carry === 'dropped') return 'no'
  }
  if (rule.requiresInvestment) {
    const invested = item.system?.equipped?.invested
    if (invested === undefined || invested === null) return 'unknown'
    if (!invested) return 'no'
  }
  return 'yes'
}

export interface CollectResult {
  modifiers: EngineModifier[]
  applied: number
  skipped: SkippedRule[]
  conditional: ConditionalModifier[]
}

export function collectFlatModifiers(
  items: readonly EngineItem[],
  domains: readonly string[],
  options: RollOptionSet,
  context: ValueContext
): CollectResult {
  const wanted = new Set(domains)
  const modifiers: EngineModifier[] = []
  const draft = emptyLedger()

  for (const item of items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as FlatModifierRule
      const key = rule.key
      if (!key) continue
      if (rule.ignored) continue

      const selectors = (Array.isArray(rule.selector) ? rule.selector : [rule.selector]).filter(
        (selector): selector is string => typeof selector === 'string'
      )
      // Computed the same way the applied path computes it, so a skip and a
      // successful application name the same modifier.
      const ruleSlug = rule.slug ?? sluggify(rule.label ?? item.name ?? '')

      if (key !== 'FlatModifier') {
        if (NEVER_AFFECTS_A_TOTAL.has(key)) continue
        // Only report a rule that could plausibly touch these domains, so the
        // ledger measures THIS figure's gaps rather than every rule on the
        // actor. A rule with no selector at all (ActiveEffectLike writes a path,
        // GrantItem grants an item) cannot be matched, so it is reported only
        // when it names a domain we care about.
        if (selectors.some((selector) => wanted.has(selector))) {
          draft.skipped.push({
            reason: 'unsupported-key',
            key,
            slug: ruleSlug,
            itemName: item.name
          })
        }
        continue
      }

      if (!selectors.some((selector) => wanted.has(selector))) continue
      // A damage modifier reaching a check domain is not this engine's business.
      if (rule.damageType) continue
      // Battle-form modifiers only apply inside a battle form, which the engine
      // has no way to detect.
      if (rule.battleForm) {
        draft.skipped.push({
          reason: 'unsupported-key',
          key,
          slug: ruleSlug,
          itemName: item.name,
          detail: 'battleForm'
        })
        continue
      }

      const requirement = requirementMet(rule, item)
      if (requirement === 'no') continue
      if (requirement === 'unknown') {
        draft.skipped.push({
          reason: 'unconfirmable-requirement',
          key,
          slug: ruleSlug,
          itemName: item.name,
          detail: rule.requiresInvestment ? 'invested' : 'equipped'
        })
        continue
      }

      // Asked twice, of two readings of the same option set. `asRolled` answers
      // the way PF2e answers — roll-context options are absent — and its verdict
      // decides the number. `asPersistent` withholds those, and is consulted
      // only to explain a `false`.
      const verdict = testPredicate(rule.predicate, asRolled(options))
      if (verdict === 'unknown') {
        // Unknown even when context is granted, so something the engine cannot
        // see is load-bearing. The only honest gap.
        draft.skipped.push({
          reason: 'unresolvable-predicate',
          key,
          slug: ruleSlug,
          itemName: item.name,
          detail: JSON.stringify(rule.predicate).slice(0, 120)
        })
        continue
      }
      if (verdict === 'false') {
        // False once the roll is supposed, so the roll is what it was waiting
        // for: conditional rather than inapplicable. False both ways means this
        // character can never trigger it, and there is nothing to show.
        if (testPredicate(rule.predicate, asPersistent(options)) === 'unknown') {
          draft.conditional.push({
            slug: ruleSlug,
            label: rule.label ?? item.name ?? ruleSlug,
            modifier: Number(rule.value) || 0,
            type: rule.type ?? 'untyped',
            itemName: item.name,
            predicate: rule.predicate
          })
        }
        continue
      }

      const resolved = resolveValue(rule.value, {
        ...context,
        itemBadge: item.system?.badge?.value
      })
      if (!resolved.ok) {
        draft.skipped.push({
          reason: 'unresolvable-value',
          key,
          slug: ruleSlug,
          itemName: item.name,
          detail: resolved.reason
        })
        continue
      }

      const label = rule.label ?? item.name ?? rule.slug ?? 'modifier'
      // PF2e clamps between `min` and `max`, each defaulting to the value
      // itself so an absent bound is a no-op rather than a zero.
      const clamped = Math.min(
        Math.max(resolved.value, rule.min ?? resolved.value),
        rule.max ?? resolved.value
      )

      modifiers.push({
        slug: rule.slug ?? sluggify(label),
        label,
        modifier: clamped,
        type: rule.type ?? 'untyped',
        enabled: true,
        hideIfDisabled: !!rule.hideIfDisabled,
        force: !!rule.force,
        source: item.name ?? ''
      })
      draft.applied++
    }
  }

  return {
    modifiers,
    applied: draft.applied,
    skipped: draft.skipped,
    conditional: draft.conditional
  }
}

// The fields the stacking contest reads, and nothing else.
//
// Deliberately loose, because two very different lists have to run through the
// same contest: the engine's own modifiers, and the trimmed ones that arrive
// over the wire and are re-contested every time a player toggles one.
export interface Stackable {
  type?: string | null
  modifier?: number | null
  enabled?: boolean | null
  force?: boolean | null
  ignored?: boolean | null
}

// PF2e's `applyStackingRules`, as the single place this rule is written.
//
// Returns one verdict per input index rather than a new list or a set of slugs.
// Indices because the two callers address modifiers differently — the engine by
// object, the UI by slug — and slugs are neither unique nor always present, so
// resolving by them would silently mark the wrong row.
//
// `isEnabled` is the seam that made unification possible. The engine asks about
// its own `enabled`; the sheet asks about `enabled` as overridden by the player,
// which is the whole reason the UI needs to re-run this at all — toggling a
// modifier changes who wins, and neither PF2e nor the engine knows what was
// toggled.
//
// Three details are easy to get wrong, and this had all three wrong:
//
//  1. ABILITY modifiers contest as ONE group across both signs, not as
//     best-positive plus worst-negative. Two of opposite sign leave one
//     survivor, not two.
//  2. `force` is NOT a general exemption. It is read in exactly one place in
//     pf2e 8.4.1 — the ability pre-pass, where it wins outright. A forced
//     circumstance bonus competes like any other.
//  3. Ties go to the LAST modifier: the comparators are `>=` and `<=`, so a
//     later equal entry displaces an earlier one. Same total, different row
//     marked — and the marked row is what the breakdown shows.
export function stackingOutcome<T extends Stackable>(
  modifiers: readonly T[],
  isEnabled: (modifier: T) => boolean = (modifier) => !!modifier.enabled
): boolean[] {
  const amount = (modifier: T) => modifier.modifier ?? 0
  const kind = (modifier: T) => modifier.type ?? 'untyped'
  // `ignored` is an INPUT, not a result: PF2e sets it on a modifier from an
  // unequipped or uninvested item, and such a modifier enters no contest.
  const live = modifiers.map((modifier) => isEnabled(modifier) && !modifier.ignored)

  // (1) and (2): the ability pre-pass, transcribed.
  let winner = -1
  modifiers.forEach((modifier, index) => {
    if (!live[index] || kind(modifier) !== 'ability') return
    if (winner < 0 || modifier.force) {
      winner = index
      return
    }
    if (modifiers[winner].force) return
    if (amount(modifier) > amount(modifiers[winner])) winner = index
  })
  modifiers.forEach((modifier, index) => {
    if (kind(modifier) === 'ability' && index !== winner) live[index] = false
  })

  // The per-type contest, one bucket per type and sign.
  const applies = modifiers.map(() => false)
  const bonuses = new Map<string, number>()
  const penalties = new Map<string, number>()
  modifiers.forEach((modifier, index) => {
    if (!live[index]) return
    if (kind(modifier) === 'untyped') {
      applies[index] = true
      return
    }
    const negative = amount(modifier) < 0
    const bucket = negative ? penalties : bonuses
    const incumbent = bucket.get(kind(modifier))
    if (incumbent === undefined) {
      applies[index] = true
      bucket.set(kind(modifier), index)
      return
    }
    // (3): `>=` / `<=`, so equal displaces.
    const better = negative
      ? amount(modifier) <= amount(modifiers[incumbent])
      : amount(modifier) >= amount(modifiers[incumbent])
    if (!better) return
    applies[incumbent] = false
    applies[index] = true
    bucket.set(kind(modifier), index)
  })
  return applies
}

// The contest resolved back onto the modifiers, which is what makes a breakdown
// honest. PF2e reports the losers too — a live character's untrained Arcana
// shows `proficiency:0:proficiency:false` beside
// `untrained-improvisation:4:proficiency:true`, and the pair reverses once the
// skill is trained.
//
// Every modifier the engine collects is pushed `enabled: true`, because a
// predicate that failed never gets pushed at all. So in an ENGINE list,
// `enabled: false` means precisely "outranked" — which is what lets the sheet
// tell an outranked row from a switched-off one.
export function resolveStacking(modifiers: readonly EngineModifier[]): EngineModifier[] {
  const applies = stackingOutcome(modifiers)
  return modifiers.map((modifier, index) =>
    modifier.enabled === applies[index] ? modifier : { ...modifier, enabled: applies[index] }
  )
}

export function applyStacking(modifiers: readonly EngineModifier[]): number {
  const applies = stackingOutcome(modifiers)
  return modifiers.reduce(
    (total, modifier, index) => (applies[index] ? total + modifier.modifier : total),
    0
  )
}
