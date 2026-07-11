import type { UpdateActorArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { getGame, makeAck } from '../utils/foundry'

// The update runs with GM rights, so a naive `actor.update(args.update)` lets
// an owner write anything Foundry normally reserves — `ownership`, identity
// fields, arbitrary flags. Allowlist the exact paths the app edits rather than
// blocklisting known-bad roots: a blocklist only inspected the first path
// segment, so deep writes under an allowed root slipped through.
//
// Adding a new editable field to the app means adding its path here — the
// module rejects unknown paths with an error ack, so a missing entry shows up
// as a visible failure during development, not a silent privileged write.
const ALLOWED_UPDATE_PATHS = new Set([
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

// Exported for unit tests. Returns the update as dot-notation paths (which
// Foundry's Document#update accepts natively) restricted to the allowlist,
// plus whatever was dropped so the handler can report it.
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

export async function foundryUpdateActor(args: UpdateActorArgs) {
  const source = getGame()
  const actor = source.actors.get(args.actorId, { strict: true })
  const { clean, dropped } = sanitizeActorUpdate(args.update as Record<string, unknown>)
  if (dropped.length) logger.warn('TM-UPDATE-ACTOR: dropped unpermitted paths', dropped)
  // An update with nothing left is a client/module mismatch or an attempted
  // privileged write — fail loudly instead of acking a write that never
  // happened.
  if (!Object.keys(clean).length) {
    throw new Error(`Update contains no permitted fields (dropped: ${dropped.join(', ')})`)
  }
  await actor.update(clean)
  return makeAck(args)
}
