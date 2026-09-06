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

// Paths the applier will accept even when the seed does not name them, because
// the set is open: a character can be trained in a lore nobody enumerated, and a
// "choose a skill" feat writes to whichever slug was chosen. Anything matching
// starts at 0 rather than being dropped.
const DYNAMIC_PATHS = [/^system\.skills\.[a-z0-9-]+\.rank$/]

// Resolve `{item|some.path}` inside a rule's `path`.
//
// PF2e's `resolveInjectedProperties`, narrowed to the one form that appears in a
// path: a read off the rule's own item. "Skilled Human (Thievery)" writes to
// `system.skills.{item|flags.system.rulesSelections.skill}.rank`, and every
// choose-a-skill feat does the same — so without this they are not merely
// unresolved, they never match a seed key and are dropped before the ledger can
// see them. Silent, which is the one thing the ledger exists to prevent.
function resolveInjectedPath(path: string, item: EngineItem): string | null {
  if (!path.includes('{')) return path
  let failed = false
  const resolved = path.replace(/\{item\|([^}]+)\}/g, (_match, inner: string) => {
    let cursor: unknown = item
    for (const step of inner.split('.')) {
      if (cursor === null || typeof cursor !== 'object') return (failed = true), ''
      cursor = (cursor as Record<string, unknown>)[step]
    }
    if (typeof cursor !== 'string' || !cursor) return (failed = true), ''
    return cursor
  })
  return failed || resolved.includes('{') ? null : resolved
}

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

  const wanted = (path: string) => path in paths || DYNAMIC_PATHS.some((re) => re.test(path))

  const candidates: { rule: AeLikeRule; item: EngineItem; path: string | null }[] = []
  for (const item of items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as AeLikeRule
      if (rule.key !== 'ActiveEffectLike' || rule.ignored) continue
      if (typeof rule.path !== 'string') continue
      const resolved = resolveInjectedPath(rule.path, item)
      // An unresolvable injection still has to be judged: if the LITERAL path
      // could only ever have been one this caller cares about, it is a gap worth
      // reporting rather than a rule aimed elsewhere.
      if (resolved === null) {
        if (DYNAMIC_PATHS.some((re) => re.test(rule.path!.replace(/\{[^}]+\}/, 'x')))) {
          candidates.push({ rule, item, path: null })
        }
        continue
      }
      if (!wanted(resolved)) continue
      candidates.push({ rule, item, path: resolved })
    }
  }
  candidates.sort(
    (a, b) => (a.rule.priority ?? DEFAULT_PRIORITY) - (b.rule.priority ?? DEFAULT_PRIORITY)
  )

  for (const { rule, item, path: resolvedPath } of candidates) {
    if (resolvedPath === null) {
      draft.skipped.push({
        reason: 'unresolvable-value',
        key: 'ActiveEffectLike',
        slug: rule.path,
        itemName: item.name,
        detail: `unresolvable path ${rule.path}`
      })
      continue
    }
    const path = resolvedPath
    // A dynamic path the seed never named starts untrained rather than absent.
    if (!(path in paths)) paths[path] = 0
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
