// A deliberately small PF2e rule engine: the module's public surface.
//
// See ./README.md for what this is for, which rule element types are
// implemented, the three-valued option model and the confidence contract.
//
// Two rules that every file in here depends on, restated because breaking
// either is silent:
//
//   * The GM's answer is canonical. A prepared figure on a payload wins over
//     anything computed here, always.
//   * Nothing computed here is ever written back to a document. Persisting an
//     estimate makes it the record and destroys the oracle — PF2e's own answer
//     on the next payload — that keeps the engine honest.

import type { VersionVerdict } from './ledger'

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
// against. A system upgrade downgrades every figure to `unverified` rather than
// quietly changing what they mean.
export const VERIFIED_PF2E_VERSION = '8.4.1'

// A world announces `pf2e@8.4.1|en|1.4.0`; only the system version matters here.
// Three answers, not two — see VersionVerdict.
export function versionVerdict(stamp: string | undefined): VersionVerdict {
  if (!stamp) return 'unknown'
  return stampMatchesVerifiedVersion(stamp) ? 'verified' : 'mismatched'
}

// Not exported: `versionVerdict` is the only question a caller has, and an
// exported predicate beside it invites a second, subtly different gate.
function stampMatchesVerifiedVersion(stamp: string | undefined): boolean {
  if (!stamp) return false
  const system = stamp.split('|')[0] ?? ''
  const version = system.split('@')[1] ?? ''
  // Major and minor only. Pinning to the patch would leave every table
  // `unverified` most of the time, which trains the reader to ignore the marker.
  const [major, minor] = version.split('.')
  const [vMajor, vMinor] = VERIFIED_PF2E_VERSION.split('.')
  return major === vMajor && minor === vMinor
}

// NO SECOND ENTRY POINT. Everything goes through ./statistics, whose
// `DerivationInput` is the single description of an actor the engine answers
// about. There used to be a `deriveFigure` here that only the differential
// harness called, which made the harness measure a path production never runs.
