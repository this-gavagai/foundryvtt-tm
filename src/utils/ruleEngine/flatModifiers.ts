import { testPredicate, type PredicateStatement } from './predicate'
import { resolveValue, type ValueContext } from './resolveValue'
import type { RollOptionSet } from './rollOptions'
import { emptyLedger, type SkippedRule } from './ledger'

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

      const verdict = testPredicate(rule.predicate, options)
      if (verdict === 'false') continue
      if (verdict === 'unknown') {
        draft.skipped.push({
          reason: 'unresolvable-predicate',
          key,
          slug: ruleSlug,
          itemName: item.name,
          detail: JSON.stringify(rule.predicate).slice(0, 120)
        })
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

  return { modifiers, applied: draft.applied, skipped: draft.skipped }
}

// PF2e's `applyStackingRules`, resolved onto the modifiers themselves.
//
// Returns the list with `enabled` set to what actually applies: within each
// non-untyped type only the best positive and the worst negative survive, and
// `force` exempts a modifier from the contest.
//
// Resolving it onto the list rather than just summing is what makes the
// breakdown honest. PF2e reports the losers too — a live character's untrained
// Arcana shows `proficiency:0:proficiency:false` beside
// `untrained-improvisation:4:proficiency:true`, and the pair reverses once the
// skill is trained. Marking everything enabled would have shown Untrained
// Improvisation as applying to a trained skill, which is exactly the thing the
// stacking fix stopped it from doing to the TOTAL.
export function resolveStacking(modifiers: readonly EngineModifier[]): EngineModifier[] {
  const best = new Map<string, { positive?: EngineModifier; negative?: EngineModifier }>()
  for (const modifier of modifiers) {
    if (!modifier.enabled || modifier.type === 'untyped' || modifier.force) continue
    const bucket = best.get(modifier.type) ?? {}
    if (modifier.modifier >= 0) {
      if (!bucket.positive || modifier.modifier > bucket.positive.modifier)
        bucket.positive = modifier
    } else if (!bucket.negative || modifier.modifier < bucket.negative.modifier) {
      bucket.negative = modifier
    }
    best.set(modifier.type, bucket)
  }
  return modifiers.map((modifier) => {
    if (!modifier.enabled || modifier.type === 'untyped' || modifier.force) return modifier
    const bucket = best.get(modifier.type)
    const wins = bucket?.positive === modifier || bucket?.negative === modifier
    return wins ? modifier : { ...modifier, enabled: false }
  })
}

export function applyStacking(modifiers: readonly EngineModifier[]): number {
  return resolveStacking(modifiers).reduce(
    (total, modifier) => (modifier.enabled ? total + modifier.modifier : total),
    0
  )
}
