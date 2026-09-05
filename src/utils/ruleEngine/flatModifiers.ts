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

const sluggify = (input: string) =>
  input
    .toLowerCase()
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
        // Only report a rule that could plausibly touch these domains, so the
        // ledger measures THIS figure's gaps rather than every rule on the
        // actor. A rule with no selector at all (ActiveEffectLike writes a path,
        // GrantItem grants an item) cannot be matched, so it is reported only
        // when it names a domain we care about.
        if (selectors.some((selector) => wanted.has(selector))) {
          draft.skipped.push({ reason: 'unsupported-key', key, slug: ruleSlug, itemName: item.name })
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

// PF2e's `applyStackingRules`, over the engine's own modifiers.
//
// Same shape as the sheet's existing simulation in useModifierOverrides — same
// non-untyped type, only the best positive and the worst negative survive — but
// operating on modifiers before they reach the UI, and honouring `force`, which
// exempts a modifier from the contest entirely.
export function applyStacking(modifiers: readonly EngineModifier[]): number {
  const byType = new Map<string, EngineModifier[]>()
  let total = 0
  for (const modifier of modifiers) {
    if (!modifier.enabled) continue
    if (modifier.type === 'untyped' || modifier.force) {
      total += modifier.modifier
      continue
    }
    const bucket = byType.get(modifier.type) ?? []
    bucket.push(modifier)
    byType.set(modifier.type, bucket)
  }
  for (const bucket of byType.values()) {
    const positives = bucket.filter((m) => m.modifier >= 0).map((m) => m.modifier)
    const negatives = bucket.filter((m) => m.modifier < 0).map((m) => m.modifier)
    if (positives.length) total += Math.max(...positives)
    if (negatives.length) total += Math.min(...negatives)
  }
  return total
}
