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

// Rank paths, as SHAPES rather than literal keys.
//
// Used to judge a path whose injection could not be resolved. The literal key is
// unknowable by definition in that case, so testing it against the seed always
// fails and the rule is dropped without a word — which is how an unresolved
// armour-proficiency choice left an AC seven points low with an empty ledger.
const RANK_SHAPES = [
  /^system\.skills\.[^.]+\.rank$/,
  /^system\.saves\.[^.]+\.rank$/,
  /^system\.perception\.rank$/,
  /^system\.proficiencies\.(defenses|attacks)\.[^.]+\.rank$/,
  /^system\.proficiencies\.(classDCs|spellcasting)\.rank$/
]

// A ChoiceSet's stored answer, by the flag it writes to.
//
// This is what makes an injected path resolvable from source. PF2e populates
// `flags.<namespace>.rulesSelections.<flag>` at prepare time from a ChoiceSet
// rule — the flag itself is NOT persisted — but the ChoiceSet's own `selection`
// IS, on the same item, in plain source data:
//
//   { key: "ChoiceSet", flag: "armorProficiency", selection: "medium" }
//   { key: "ActiveEffectLike", mode: "upgrade",
//     path: "system.proficiencies.defenses.{item|flags.…rulesSelections.armorProficiency}.rank" }
//
// Matching on the flag rather than walking the item's own `flags` is also
// namespace-agnostic, which matters because the path says `flags.system.…`
// while the runtime object is keyed by the system id.
function choiceSelection(item: EngineItem, flag: string): string | null {
  for (const raw of item.system?.rules ?? []) {
    const rule = raw as { key?: string; flag?: string; selection?: unknown }
    if (rule.key !== 'ChoiceSet' || rule.flag !== flag) continue
    return typeof rule.selection === 'string' && rule.selection ? rule.selection : null
  }
  return null
}

// Resolve `{item|some.path}` inside a rule's `path`.
//
// PF2e's `resolveInjectedProperties`, narrowed to the forms that appear in a
// path. Every "choose a skill" or "choose an armour proficiency" feat uses one —
// Kyra's Armor Proficiency (Medium) is exactly this shape, and reading it wrong
// left her AC seven points low.
function resolveInjectedPath(path: string, item: EngineItem): string | null {
  if (!path.includes('{')) return path
  let failed = false
  const resolved = path.replace(/\{item\|([^}]+)\}/g, (_match, inner: string) => {
    // A rules selection: answered by the ChoiceSet that writes the flag.
    const selection = /^flags\.[^.]+\.rulesSelections\.([A-Za-z0-9_-]+)$/.exec(inner)
    if (selection) {
      // The ChoiceSet is the reliable source, but fall through to a literal
      // read if an item does carry the flag: both are legitimate shapes and
      // preferring one need not exclude the other.
      const chosen = choiceSelection(item, selection[1])
      if (chosen) return chosen
    }
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
        // Judge the literal shape with the injection stood in for. Previously
        // only the skills pattern was considered, so an unresolvable injection
        // on an armour or save path was dropped without a word — which is how
        // a seven-point AC error reached the sheet with an empty ledger.
        const shape = rule.path.replace(/\{[^}]+\}/g, 'x')
        if (RANK_SHAPES.some((re) => re.test(shape))) {
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
