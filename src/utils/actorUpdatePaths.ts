// Shared allowlist for actor writes, used by BOTH ends of the wire:
//   - api/documents.ts sanitizes before posting a direct modifyDocument update
//     (the app writes to its own owned actor over the socket).
//   - foundry/handlers/updateActor.ts sanitizes the legacy UPDATE_ACTOR RPC a
//     stale app might still send, so the guard holds on both paths.
//
// A direct socket write is bounded only by Foundry's owner-permission model,
// under which an OWNER can write far more than the handful of fields the app
// edits (all system data, arbitrary flags, ownership, identity). Allowlist the
// exact paths rather than blocklisting known-bad roots: a blocklist only
// inspecting the first path segment lets deep writes under an allowed root
// through. This is defense-in-depth against an app bug sending an over-broad
// update — not a security boundary (the user owns the actor and could edit it
// through Foundry directly regardless).
//
// Adding a new editable field to the app means adding its path here — an
// unlisted path is dropped, surfacing as a visible failure during development
// rather than a silent privileged write. That loud failure is half the point:
// it is less a filter than a registration requirement, and the only enforced
// piece of the lane story (api/documents.ts describes the rest, which nothing
// checks).
//
// ── Why this guards the ACTOR path and not the item path ────────────────────
//
// Deliberate, not an oversight. updateActorItem / createActorItem /
// deleteActorItem have no equivalent, and should not: the two document shapes
// differ in a way that decides whether an allowlist can work at all.
//
// Every legitimate app write to an ACTOR is a narrow scalar setter, so the list
// below is both cheap and COMPLETE — anything outside it is dropped, and the
// realistic bug it catches is an ordinary one, a whole subtree written back by
// a spread gone wrong (`updateActor(actor, { system: actor.value.system })`),
// which flattens to leaves here and fails loudly. That matters most on the
// actor, which is one document holding `ownership`, `prototypeToken`, every
// flag, and GM-facing content like `details.biography.campaignNotes` and
// `biography.visibility`.
//
// Item writes are not all narrow. Several legitimate ones are a whole ARRAY
// (`system.rules`, for roll-option toggles and the blast action cost) or a
// whole DOCUMENT (a stack split, a party transfer, a coin stack). An allowlist
// there would bound the dozen narrow paths and structurally could not bound
// those — advertising a completeness it does not have, which is worse than not
// having it. Items are also narrower in blast radius: one typed document at a
// time rather than the actor's whole mixed field space.
//
// So the guard fits one shape and half-fits the other. The better move for the
// item path was to make its BROAD writes named rather than incidental — a
// separate function for a whole-array write, so it is deliberate and greppable —
// instead of an allowlist that can only cover the easy half. That is now
// `replaceItemRules` in api/documents.ts, and `system.rules` is the only array
// the app writes whole: the other 21 updateActorItem call sites are narrow
// scalars, checked one by one.
//
// The two lanes therefore fail loudly for the same class of mistake, by
// different means and with different reach. On the actor, an unlisted PATH is
// dropped and reported, which catches a write that was never meant to be made.
// On an item there is no path list to check against, so what is checked is the
// only thing that can be: that a whole-array write is replacing something with
// something, rather than stripping an item's rule elements because the mirror it
// was built from had moved on. Neither is a security boundary — the user owns
// the actor — and neither pretends to cover the other's ground.
export const ALLOWED_UPDATE_PATHS = new Set([
  // Hit points normally route through SET_HIT_POINTS so the preUpdateActor
  // automation modules hang off it runs (composables/setHitPoints.ts). These
  // two entries are the NO-GM fallback path and are not redundant: remove them
  // and hit-point editing breaks for exactly the case the fallback exists to
  // serve, and only when no GM is listening to notice.
  'system.attributes.hp.value',
  'system.attributes.hp.temp',
  'system.resources.heroPoints.value',
  'system.resources.focus.value',
  'system.details.xp.value',
  'system.initiative.statistic',
  // The character's active exploration activities: a whole array of item ids,
  // written and read as one value the way PF2e's own toggle does. It is a leaf
  // here because flattenUpdate stops at arrays.
  'system.exploration',
  // Staff charges live under the pf2e-dailies module's actor flag.
  'flags.pf2e-dailies.extra.dailies.staves.charges.value'
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// Flatten a (possibly mixed nested/dot-notation) update object into leaf
// paths, so `{ system: { attributes: { hp: { value: 5 } } } }` and
// `{ 'system.attributes.hp.value': 5 }` sanitize identically.
function flattenUpdate(
  update: Record<string, unknown>,
  prefix = '',
  out: Record<string, unknown> = {}
): Record<string, unknown> {
  for (const [key, value] of Object.entries(update)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) flattenUpdate(value, path, out)
    else out[path] = value
  }
  return out
}

// Returns the update as dot-notation paths (which Foundry's Document#update
// accepts natively) restricted to the allowlist, plus whatever was dropped so
// the caller can report it.
export function sanitizeActorUpdate(update: Record<string, unknown>): {
  clean: Record<string, unknown>
  dropped: string[]
} {
  const clean: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [path, value] of Object.entries(flattenUpdate(update))) {
    if (ALLOWED_UPDATE_PATHS.has(path)) clean[path] = value
    else dropped.push(path)
  }
  return { clean, dropped }
}
