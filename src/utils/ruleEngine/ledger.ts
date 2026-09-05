// What the engine could not account for, and how much that matters.
//
// Built before any rule element was, because it is the thing that makes the rest
// defensible. A derived figure is only ever a stand-in for the GM's answer, so
// the engine does not have to be right — it has to know when it isn't, and say
// so loudly enough that the sheet can mark the number rather than present it as
// PF2e's.
//
// PF2e models the same discipline internally: when `resolveValue` meets a
// formula it cannot resolve, it sets `ignored = true` and drops the rule instead
// of substituting a plausible number. Everything here is that idea, made
// countable.

// Why a rule did not contribute. Kept apart rather than collapsed to "skipped"
// because they carry different risk, and the sheet may eventually want to say
// different things about them.
export type SkipReason =
  // A rule element type the engine does not implement. Detectable — the `key` is
  // right there — so it is a KNOWN unknown, and the commonest one.
  | 'unsupported-key'
  // Understood, but its predicate references a roll option outside the closed
  // set (see rollOptions.ts). Not the same as a predicate that tested false.
  | 'unresolvable-predicate'
  // Understood, but its value is a formula reaching data the engine cannot see —
  // typically an `@actor.` path into derived state.
  | 'unresolvable-value'
  // Understood and resolvable, but the item carrying it is in a state the rule
  // requires and the engine cannot confirm (equipped, invested).
  | 'unconfirmable-requirement'

export interface SkippedRule {
  reason: SkipReason
  // The rule element's `key`, for grouping and for telling which type is costing
  // the most coverage across a real table.
  key: string
  // The modifier slug this rule WOULD have produced.
  //
  // Not decoration: it is how a skip is attributed to a specific missing
  // modifier. Without it the only link back is the item's name, which does not
  // match the slug in general — and an unattributable skip reads to the
  // differential harness as a SILENT miss, i.e. as a failure of the very
  // machinery that recorded it. Absent only where the rule declares no slug and
  // carries no label to derive one from.
  slug?: string
  // The item the rule came from, so a skip can be explained to a player as "the
  // engine did not account for your Bracers of Armor" rather than as a slug.
  itemName?: string
  // What specifically could not be resolved: the option, the formula, the field.
  detail?: string
}

// How much the engine is willing to claim for a figure.
//
//   'exact'       nothing was skipped, and every rule it saw it resolved. The
//                 number should equal PF2e's.
//   'provisional' something was skipped. The number is a lower bound on
//                 confidence, not on value — a skipped penalty makes it too
//                 high, a skipped bonus too low.
//   'unverified'  the world runs a PF2e version this engine was not checked
//                 against. Nothing may LOOK wrong; that is the point.
export type Confidence = 'exact' | 'provisional' | 'unverified'

export interface Ledger {
  applied: number
  skipped: SkippedRule[]
  confidence: Confidence
}

export function emptyLedger(): { applied: number; skipped: SkippedRule[] } {
  return { applied: 0, skipped: [] }
}

// Seal a ledger with the version verdict folded in.
//
// `versionMatches` outranks a clean skip list deliberately. "No rule was
// skipped" only means no rule the engine RECOGNIZED was skipped; a rule element
// whose behaviour changed under it is invisible from here, and the system
// version is the only signal that it might have. A wrong number after a system
// upgrade arrives without any code changing, which makes it the failure mode
// least likely to be noticed and the one worth being most conservative about.
export function sealLedger(
  draft: { applied: number; skipped: SkippedRule[] },
  versionMatches: boolean
): Ledger {
  const confidence: Confidence = !versionMatches
    ? 'unverified'
    : draft.skipped.length > 0
      ? 'provisional'
      : 'exact'
  return { applied: draft.applied, skipped: draft.skipped, confidence }
}

// A one-line summary for a tooltip or a log line. Deliberately names the count
// rather than hiding it behind a word: "provisional" alone invites the reader to
// assume the gap is small.
export function describeLedger(ledger: Ledger): string {
  if (ledger.confidence === 'unverified') return 'not verified against this PF2e version'
  if (ledger.skipped.length === 0) return 'complete'
  const byReason = new Map<SkipReason, number>()
  for (const skip of ledger.skipped) byReason.set(skip.reason, (byReason.get(skip.reason) ?? 0) + 1)
  const parts = [...byReason.entries()].map(([reason, count]) => `${count} ${reason}`)
  return `${ledger.skipped.length} not evaluated (${parts.join(', ')})`
}
