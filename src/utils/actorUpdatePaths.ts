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
// rather than a silent privileged write.
export const ALLOWED_UPDATE_PATHS = new Set([
  'system.attributes.hp.value',
  'system.attributes.hp.temp',
  'system.resources.heroPoints.value',
  'system.resources.focus.value',
  'system.details.xp.value',
  'system.initiative.statistic',
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
