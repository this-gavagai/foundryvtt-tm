import { testPredicate, type PredicateStatement } from './predicate'
import { resolveValue, type ValueContext } from './resolveValue'
import type { RollOptionSet } from './rollOptions'
import { emptyLedger, type SkippedRule } from './ledger'
import type { EngineItem } from './flatModifiers'

// ActiveEffectLike: a rule element that writes a number straight onto the actor.
//
// The second type this engine implements, and it is not optional for Tier 2.
// PF2e seeds a character's proficiency ranks from the class item's own source
// fields — `class.system.savingThrows.fortitude`, `.defenses.light`,
// `.perception` — and then every class feature that raises one does it with an
// ActiveEffectLike `upgrade` on `system.saves.fortitude.rank`. Without this, a
// level 15 fighter's Fortitude reads as the rank they had at level 1, and the
// resulting save is wrong by four to six points while looking entirely ordinary.
//
// Bounded on purpose. It applies NUMERIC modes to a caller-supplied map of
// paths, and does not touch anything else: no array writes, no flags, no string
// overrides, no creating paths the caller did not ask about. A rule aimed
// outside that map is not this engine's business and is not reported; a rule
// aimed INSIDE it that cannot be resolved is reported, because it changes a
// number the caller is about to show.

type Mode = 'add' | 'subtract' | 'remove' | 'multiply' | 'upgrade' | 'downgrade' | 'override'

const NUMERIC_MODES = new Set<Mode>([
  'add',
  'subtract',
  'remove',
  'multiply',
  'upgrade',
  'downgrade',
  'override'
])

interface AeLikeRule {
  key?: string
  mode?: string
  path?: string
  value?: unknown
  predicate?: PredicateStatement[]
  priority?: number
  ignored?: boolean
}

// PF2e's default rule-element priority. AE-likes are ordered by it because the
// modes are not commutative: an `override` after an `add` erases it, and the
// same two in the other order do not.
const DEFAULT_PRIORITY = 50

function applyMode(mode: Mode, current: number, value: number): number {
  switch (mode) {
    case 'add':
      return current + value
    case 'subtract':
    case 'remove':
      return current - value
    case 'multiply':
      return current * value
    case 'upgrade':
      return Math.max(current, value)
    case 'downgrade':
      return Math.min(current, value)
    case 'override':
      return value
  }
}

export interface AeLikeResult {
  // The paths that were asked about, with every applicable rule folded in.
  paths: Record<string, number>
  applied: number
  skipped: SkippedRule[]
}

// Fold every ActiveEffectLike aimed at one of `seed`'s paths into it.
//
// `seed` is both the starting values and the declaration of interest: a path it
// does not carry is ignored entirely, which is what keeps this from becoming a
// general actor-data interpreter.
export function applyActiveEffectLikes(
  items: readonly EngineItem[],
  seed: Record<string, number>,
  options: RollOptionSet,
  context: ValueContext
): AeLikeResult {
  const paths = { ...seed }
  const draft = emptyLedger()

  const candidates: { rule: AeLikeRule; item: EngineItem }[] = []
  for (const item of items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as AeLikeRule
      if (rule.key !== 'ActiveEffectLike' || rule.ignored) continue
      if (typeof rule.path !== 'string') continue
      if (!(rule.path in paths)) continue
      candidates.push({ rule, item })
    }
  }
  candidates.sort(
    (a, b) => (a.rule.priority ?? DEFAULT_PRIORITY) - (b.rule.priority ?? DEFAULT_PRIORITY)
  )

  for (const { rule, item } of candidates) {
    const path = rule.path as string
    const mode = rule.mode as Mode | undefined
    if (!mode || !NUMERIC_MODES.has(mode)) {
      draft.skipped.push({
        reason: 'unsupported-key',
        key: 'ActiveEffectLike',
        slug: path,
        itemName: item.name,
        detail: `mode ${rule.mode}`
      })
      continue
    }

    const verdict = testPredicate(rule.predicate, options)
    if (verdict === 'false') continue
    if (verdict === 'unknown') {
      draft.skipped.push({
        reason: 'unresolvable-predicate',
        key: 'ActiveEffectLike',
        slug: path,
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
        key: 'ActiveEffectLike',
        slug: path,
        itemName: item.name,
        detail: resolved.reason
      })
      continue
    }

    paths[path] = applyMode(mode, paths[path], resolved.value)
    draft.applied++
  }

  return { paths, applied: draft.applied, skipped: draft.skipped }
}
