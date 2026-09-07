import { testPredicate, type PredicateStatement } from './predicate'
import { resolveValue, type ValueContext } from './resolveValue'
import type { EngineItem } from './flatModifiers'
import { sealLedger, type Ledger, type SkippedRule } from './ledger'
import type { RollOptionSet } from './rollOptions'
import { versionVerdict } from './index'

// Immunities, weaknesses and resistances.
//
// The largest visible gap left on a sheet painted from source alone, and not
// close: on the ten-character test table EIGHT carry IWR granted by a rule
// element, and SIX of those have nothing in `system.attributes` at all — so
// their whole IWR panel was empty without a GM rather than merely short an
// entry. Charhide Goblin's fire resistance, Strong-Blooded Dwarf's poison, Forge
// Dwarf, Blast Resistance, Fire Gate.
//
// The values are the easy part. Every one on that table is either a plain number
// or `max(1,floor(@actor.level/2))` — shapes the value resolver already answers,
// because `@actor.level` is one of the few paths it will touch.
//
// Faithful to PF2e's IWRRuleElement in the parts that decide what shows:
//   * `type` is a list; a single string is one entry (Foundry's ArrayField
//     coerces, and source data really does carry both).
//   * a weakness or resistance of zero or less is dropped, not shown as 0.
//   * an entry for a type already present takes the HIGHER value, unless
//     `override` says to replace it outright.
//   * `mode: "remove"` deletes matching types instead of adding.
//
// Deliberately NOT modelled: `doubleVs`, `applyOnce`, and the `definition`
// predicate that gives a `custom` type its meaning. A custom entry still shows —
// with the rule's own label, which is what PF2e displays for it — but the engine
// does not evaluate what it applies to.

export type IWRKind = 'immunities' | 'weaknesses' | 'resistances'

export interface DerivedIWREntry {
  type: string
  value?: number
  exceptions?: string[]
  // What PF2e shows for a `custom` type, whose slug means nothing on its own.
  customLabel?: string
  source?: string
}

export interface DerivedIWR {
  immunities: DerivedIWREntry[]
  weaknesses: DerivedIWREntry[]
  resistances: DerivedIWREntry[]
  ledger: Ledger
}

const KEY_TO_KIND: Record<string, IWRKind> = {
  Immunity: 'immunities',
  Weakness: 'weaknesses',
  Resistance: 'resistances'
}

interface IWRRule {
  key?: string
  type?: string | string[]
  value?: unknown
  mode?: string
  override?: boolean
  predicate?: PredicateStatement[]
  exceptions?: unknown[]
  label?: string
  ignored?: boolean
}

export interface IWRInput {
  items: readonly EngineItem[]
  // The actor's own authored entries, which are plain source data and the seed
  // every rule element merges into.
  stored?: Partial<Record<IWRKind, unknown>>
  options: RollOptionSet
  context: ValueContext
  stamp?: string
}

// PF2e's exceptions are either a bare type string or `{definition, label}`.
// Only the display string survives here, matching what makeIWRs keeps.
function exceptionLabels(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') out.push(entry)
    else if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { label?: unknown }).label === 'string'
    ) {
      out.push((entry as { label: string }).label)
    }
  }
  return out.length ? out : undefined
}

function seed(stored: unknown): DerivedIWREntry[] {
  if (!Array.isArray(stored)) return []
  const out: DerivedIWREntry[] = []
  for (const entry of stored) {
    const type = (entry as { type?: unknown } | null)?.type
    if (typeof type !== 'string') continue
    const record = entry as { value?: unknown; customLabel?: unknown; source?: unknown }
    out.push({
      type,
      value: typeof record.value === 'number' ? record.value : undefined,
      exceptions: exceptionLabels((entry as { exceptions?: unknown }).exceptions),
      // Carried, not recomputed. PF2e's own prepared entries have both, and
      // dropping them here made re-deriving a prepared list lose the label a
      // `custom` type is the only way to identify — the idempotence test caught
      // it, which is the whole reason that test exists.
      customLabel: typeof record.customLabel === 'string' ? record.customLabel : undefined,
      source: typeof record.source === 'string' ? record.source : undefined
    })
  }
  return out
}

export function deriveIWR(input: IWRInput): DerivedIWR {
  const sets: Record<IWRKind, DerivedIWREntry[]> = {
    immunities: seed(input.stored?.immunities),
    weaknesses: seed(input.stored?.weaknesses),
    resistances: seed(input.stored?.resistances)
  }
  const skipped: SkippedRule[] = []
  let applied = 0

  for (const item of input.items) {
    for (const raw of item.system?.rules ?? []) {
      const rule = raw as IWRRule
      const kind = KEY_TO_KIND[rule.key ?? '']
      if (!kind || rule.ignored) continue

      // PF2e's own reading: roll-context options are absent, not unknown.
      const verdict = testPredicate(rule.predicate, input.options)
      if (verdict === 'false') continue
      if (verdict === 'unknown') {
        skipped.push({
          reason: 'unresolvable-predicate',
          key: rule.key ?? 'IWR',
          slug: Array.isArray(rule.type) ? rule.type.join(',') : rule.type,
          itemName: item.name,
          detail: JSON.stringify(rule.predicate).slice(0, 120)
        })
        continue
      }

      const types = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : []
      if (types.length === 0) continue

      // Removal first: it names types to delete and carries no value, so
      // running the value gate before it dropped every `mode: "remove"` on a
      // weakness or resistance before it could do anything.
      const set = sets[kind]
      if (rule.mode === 'remove') {
        for (const type of types) {
          const at = set.findIndex((entry) => entry.type === type)
          if (at !== -1) set.splice(at, 1)
        }
        applied++
        continue
      }

      // An immunity has no value at all; the other two are floored, and a
      // non-positive one contributes nothing rather than showing as zero.
      let value: number | undefined
      if (kind !== 'immunities') {
        const resolved = resolveValue(rule.value, input.context)
        if (!resolved.ok) {
          skipped.push({
            reason: 'unresolvable-value',
            key: rule.key ?? 'IWR',
            slug: types.join(','),
            itemName: item.name,
            detail: resolved.reason
          })
          continue
        }
        value = Math.floor(Number(resolved.value))
        if (!(value > 0)) continue
      }

      const exceptions = exceptionLabels(rule.exceptions)
      for (const type of types) {
        const existing = set.find((entry) => entry.type === type)
        if (existing && !rule.override) {
          // PF2e keeps the stronger of the two rather than stacking them.
          if (value !== undefined) existing.value = Math.max(existing.value ?? 0, value)
          continue
        }
        if (existing && rule.override) set.splice(set.indexOf(existing), 1)
        set.push({
          type,
          value,
          exceptions,
          customLabel: type === 'custom' ? (rule.label ?? item.name ?? undefined) : undefined,
          source: item.name ?? undefined
        })
      }
      applied++
    }
  }

  return {
    ...sets,
    ledger: sealLedger({ applied, skipped }, versionVerdict(input.stamp))
  }
}
