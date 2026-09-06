// A deliberately small PF2e rule engine: FlatModifier, and the honesty to say
// what it missed.
//
// ── What this is for ────────────────────────────────────────────────────────
//
// The GM's answer is canonical. Whenever a character payload has supplied a
// figure, that figure wins — always, without exception. This engine exists only
// for the case where no GM has answered, where the sheet would otherwise show a
// blank or a number computed from source alone with the rule elements silently
// missing.
//
// So it is never required to be right. It is required to know when it isn't,
// and every part of it is shaped by that: a closed roll-option set, a
// three-valued predicate evaluator, a value resolver that refuses unreachable
// paths, and a ledger that counts what it skipped. A figure that comes back
// `provisional` has a number AND a reason it might be wrong; a figure that comes
// back `exact` claims to equal PF2e's.
//
// ── What it deliberately does not do ────────────────────────────────────────
//
// It implements one rule element type out of forty. ActiveEffectLike writing
// straight to `system.attributes.hp.max`, AdjustModifier, DexterityModifierCap,
// MartialProficiency, BattleForm — all unimplemented, all COUNTED. The ledger
// turns "we don't handle that" from a silent hole into a number on screen.
//
// Its output must never be written back to a document. The moment an estimate is
// persisted it becomes the record, and the oracle that keeps this honest — the
// GM's own answer, arriving on the next payload — is gone.

import { sealLedger, type Ledger, type VersionVerdict } from './ledger'
import { buildRollOptions, type RollOptionSource, type RollOptionSet } from './rollOptions'
import { applyStacking, collectFlatModifiers, type EngineItem, type EngineModifier } from './flatModifiers'
import type { ValueContext } from './resolveValue'

export * from './ledger'
export * from './domains'
export { buildRollOptions, emptyRollOptions } from './rollOptions'
export { testPredicate, testStatement, type Truth } from './predicate'
export { resolveValue, type Resolution, type ValueContext } from './resolveValue'
export {
  applyStacking,
  collectFlatModifiers,
  type EngineItem,
  type EngineModifier
} from './flatModifiers'
export type { RollOptionSet, RollOptionSource } from './rollOptions'

// The PF2e release this engine's rule handling was read from and verified
// against. Compared with the world's system version — which the app already
// learns from the label-catalog stamp — so that a system upgrade downgrades
// every figure to `unverified` rather than quietly changing what they mean.
export const VERIFIED_PF2E_VERSION = '8.4.1'

// A world announces `pf2e@8.4.1|en|1.4.0`. Only the system version matters here;
// the locale and module version move for reasons that cannot affect arithmetic.
//
// Three answers, not two. No stamp means no GM has served the label catalog
// yet — the ordinary state on a cold sheet — and is emphatically not the same
// as a stamp that disagrees. See VersionVerdict.
export function versionVerdict(stamp: string | undefined): VersionVerdict {
  if (!stamp) return 'unknown'
  return stampMatchesVerifiedVersion(stamp) ? 'verified' : 'mismatched'
}

export function stampMatchesVerifiedVersion(stamp: string | undefined): boolean {
  if (!stamp) return false
  const system = stamp.split('|')[0] ?? ''
  const version = system.split('@')[1] ?? ''
  // Major and minor only. A patch release does move rule behaviour occasionally,
  // but pinning to it would leave every table `unverified` most of the time,
  // which trains the reader to ignore the marker — a worse failure than the one
  // it guards against.
  const [major, minor] = version.split('.')
  const [vMajor, vMinor] = VERIFIED_PF2E_VERSION.split('.')
  return major === vMajor && minor === vMinor
}

export interface EngineInput {
  items: readonly EngineItem[]
  options: RollOptionSource
  // Source-derivable actor data the formulas may reference. Anything absent
  // makes a formula that needs it unresolvable, which is the intent.
  paths: Record<string, number>
  // The world's label stamp, for the version gate.
  stamp?: string
}

export interface DerivedFigure {
  // The sum of every modifier the engine could account for, after stacking.
  // NOT a complete statistic — the caller adds the base (proficiency, attribute)
  // it already knows how to compute from source.
  total: number
  modifiers: EngineModifier[]
  ledger: Ledger
}

// Everything that reaches one statistic's domains, resolved and stacked.
export function deriveFigure(input: EngineInput, domains: readonly string[]): DerivedFigure {
  const options: RollOptionSet = buildRollOptions(input.options)
  const context: ValueContext = { paths: input.paths }
  const collected = collectFlatModifiers(input.items, domains, options, context)
  return {
    total: applyStacking(collected.modifiers),
    modifiers: collected.modifiers,
    ledger: sealLedger(
      { applied: collected.applied, skipped: collected.skipped },
      versionVerdict(input.stamp)
    )
  }
}
