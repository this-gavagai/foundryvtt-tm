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
  // A proficiency RANK the engine had to take from the class item's baseline
  // because nothing else in source names it.
  //
  // Its own reason because it is the only gap that lives in a figure's BASE
  // rather than in a modifier, and the base is what the ledger was otherwise
  // blind to. PF2e raises save and perception ranks through class features that
  // carry no rule element and write nothing to the actor — "Reflex Expertise"
  // has an empty rules array — so on a source-only sheet the rank is simply not
  // recoverable, and every affected save reads two points low. Recording it is
  // the difference between a figure that admits that and one that claims to be
  // exact while being wrong.
  | 'unconfirmable-rank'

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

// What is known about the world's PF2e version.
//
// `unknown` is NOT `mismatched`, and conflating them was a real defect. The
// stamp arrives with the label catalog, which needs a GM — so a first-time
// no-GM sheet has no stamp at all, and treating that as a version mismatch
// marked EVERY figure with the same caveat. Five of five, all reading "not
// verified against this PF2e version", when the truth was only "nobody has told
// us the version yet".
//
// A marker that appears on everything ranks nothing. It cannot say which figure
// is shakier than its neighbour, which is the only question a player has, and it
// teaches them to stop looking. The absence of a GM is already stated plainly
// elsewhere in the sheet; it does not need restating on every number.
export type VersionVerdict = 'verified' | 'mismatched' | 'unknown'

// A modifier that does not apply NOW and would apply under some roll.
//
// Not a skip, and the distinction is the point. A skip says the engine failed to
// account for something; this says the engine accounted for it correctly and the
// answer is "not yet". PF2e draws the same line by keeping the modifier in its
// list with `enabled: false` rather than dropping or flagging it.
//
// Recorded rather than discarded because it is the sheet's to show: "+2 vs
// traps" is a thing a player wants to know about their Perception, and the old
// behaviour threw it away twice over — once from the total, where it belonged,
// and once from the display, where it did not.
export interface ConditionalModifier {
  slug: string
  label: string
  modifier: number
  type: string
  itemName?: string
  // The predicate as written, so the sheet can say what it is conditional ON.
  predicate?: unknown
}

export interface Ledger {
  applied: number
  skipped: SkippedRule[]
  conditional: ConditionalModifier[]
  confidence: Confidence
}

export function emptyLedger(): {
  applied: number
  skipped: SkippedRule[]
  conditional: ConditionalModifier[]
} {
  return { applied: 0, skipped: [], conditional: [] }
}

// Seal a ledger with the version verdict folded in.
//
// A MISMATCHED version outranks a clean skip list deliberately. "No rule was
// skipped" only means no rule the engine RECOGNIZED was skipped; a rule element
// whose behaviour changed under it is invisible from here, and the system
// version is the only signal that it might have. A wrong number after a system
// upgrade arrives without any code changing, which makes it the failure mode
// least likely to be noticed and the one worth being most conservative about.
//
// An UNKNOWN version does not outrank anything. It is the ordinary state before
// a GM has ever answered, it is identical for every figure on the sheet, and
// letting it speak would drown the per-figure signal it shares a channel with.
export function sealLedger(
  draft: { applied: number; skipped: SkippedRule[]; conditional?: ConditionalModifier[] },
  version: VersionVerdict
): Ledger {
  // Conditionals deliberately do NOT reach this. A figure with six modifiers
  // waiting on a roll is not a less certain figure — it is the same number PF2e
  // reports, arrived at the same way. Letting them mark it provisional was the
  // engine calling its own agreement with PF2e a gap.
  const confidence: Confidence =
    version === 'mismatched' ? 'unverified' : draft.skipped.length > 0 ? 'provisional' : 'exact'
  return {
    applied: draft.applied,
    skipped: draft.skipped,
    conditional: draft.conditional ?? [],
    confidence
  }
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
