// What the engine could not account for, and how much that matters.
//
// A derived figure is only ever a stand-in for the GM's answer, so the engine
// does not have to be right — it has to know when it isn't, and say so loudly
// enough that the sheet can mark the number rather than present it as PF2e's.
//
// PF2e models the same discipline internally: when `resolveValue` meets a
// formula it cannot resolve it sets `ignored = true` and drops the rule rather
// than substituting a plausible number. Everything here is that idea, made
// countable. See ../README.md for the confidence contract.

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
//   'exact'       nothing was skipped. The number should equal PF2e's.
//   'provisional' something was skipped. A lower bound on CONFIDENCE, not on
//                 value — a skipped penalty makes the figure too high, a
//                 skipped bonus too low.
//   'unverified'  the world runs a PF2e version this engine was not checked
//                 against. Nothing may LOOK wrong; that is the point.
export type Confidence = 'exact' | 'provisional' | 'unverified'

// What is known about the world's PF2e version.
//
// `unknown` is NOT `mismatched`. The stamp arrives with the label catalog, which
// needs a GM, so a cold sheet has no stamp at all — and a marker that appears on
// every figure ranks nothing, cannot say which figure is shakier than its
// neighbour, and teaches a player to stop looking.
export type VersionVerdict = 'verified' | 'mismatched' | 'unknown'

// A modifier that does not apply NOW and would apply under some roll.
//
// Not a skip, and the distinction is the point. A skip says the engine failed to
// account for something; this says it accounted for one correctly and the answer
// is "not yet". PF2e draws the same line by keeping the modifier in its list with
// `enabled: false` rather than dropping it.
//
// Rendered as a disabled row in the breakdown — see
// composables/character/derivedModifiers.present.
export interface ConditionalModifier {
  slug: string
  label: string
  modifier: number
  type: string
  itemName?: string
  // The predicate as written, so the sheet can say what it is conditional ON.
  predicate?: unknown
  // The roll option(s) that switch it on, where the predicate names them
  // plainly. Present so the sheet can FEED PF2e the option and let its own
  // evaluator decide, rather than overriding `enabled` on a modifier whose slug
  // the engine reconstructed and may have reconstructed differently — see "Where
  // the GM is fed rather than re-implemented" in ../README.md. Empty for a
  // predicate with no top-level atom to lift (a bare `or`, a nested `and`),
  // which falls back to the override.
  enableOptions?: string[]
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
// A MISMATCHED version outranks a clean skip list deliberately: "no rule was
// skipped" only means no rule the engine RECOGNIZED was skipped, and a rule whose
// behaviour changed under a system upgrade is invisible from here. An UNKNOWN
// version outranks nothing — see VersionVerdict.
export function sealLedger(
  draft: { applied: number; skipped: SkippedRule[]; conditional?: ConditionalModifier[] },
  version: VersionVerdict
): Ledger {
  // Conditionals deliberately do NOT reach this. A figure with six modifiers
  // waiting on a roll is not less certain — it is the same number PF2e reports,
  // arrived at the same way.
  const confidence: Confidence =
    version === 'mismatched' ? 'unverified' : draft.skipped.length > 0 ? 'provisional' : 'exact'
  return {
    applied: draft.applied,
    skipped: draft.skipped,
    conditional: draft.conditional ?? [],
    confidence
  }
}

// A one-line summary for a tooltip, naming the ITEMS rather than the reasons.
//
// PLAYER-FACING: it lands inside `sync.provisional`, "Calculated on this device
// — {caveat}. The GM has not confirmed it." The SkipReason vocabulary is this
// file's own and means nothing to a reader of that sentence; it is the right
// axis for a console, which is what `skippedBy` on a differential row and
// `bySkippedKey` in the harness summary are for.
const MAX_NAMED = 3

export function describeLedger(ledger: Ledger): string {
  if (ledger.confidence === 'unverified') return 'not verified against this PF2e version'
  if (ledger.skipped.length === 0) return 'complete'
  // De-duplicated: one item carrying three rules the engine cannot read is one
  // thing a player has to know about, not three.
  const names: string[] = []
  for (const skip of ledger.skipped) {
    const name = skip.itemName ?? skip.slug
    if (name && !names.includes(name)) names.push(name)
  }
  if (names.length === 0) return `${ledger.skipped.length} rules not accounted for`
  const shown = names.slice(0, MAX_NAMED).join(', ')
  const rest = names.length - MAX_NAMED
  return rest > 0 ? `did not account for ${shown} and ${rest} more` : `did not account for ${shown}`
}
