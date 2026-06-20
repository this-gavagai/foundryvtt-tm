import type { TablemateActor } from '@/types/character-types'
import { idbGet, idbCount, idbPut } from '@/utils/idb'
import { useServerAddressStore } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'

// Persists the last-known character snapshot per actor so a reactivated PWA
// can paint the sheet instantly from disk while the live socket fetch catches
// up in the background (stale-while-revalidate). Stored in the 'actors' store.
//
// The IDB key is scoped to the active server's origin: two Foundry instances
// can hold actors with the same id (e.g. a world copied between servers), so an
// unscoped key would let one server's cached sheet paint on another. Scoping
// guarantees a character cached against one server can never appear on another.

// Build the per-server cache key. Returns undefined when no server is active
// (the gate is showing) — callers then treat it as a cache miss / no-op, since
// no sheet is mounted to read or write a snapshot in that state.
function scopedKey(actorId: string): string | undefined {
  const origin = useServerAddressStore().serverUrl?.origin
  if (!origin) return undefined
  // '|' can appear in neither an origin nor a Foundry actor id, so it's an
  // unambiguous delimiter between the two.
  return `${origin}|${actorId}`
}

export function loadActorSnapshot(actorId: string): Promise<TablemateActor | undefined> {
  const key = scopedKey(actorId)
  if (!key) return Promise.resolve(undefined)
  return idbGet<TablemateActor>('actors', key)
}

// Cheap existence check so the UI can decide whether to optimistically paint a
// cached sheet during the initial handshake.
export function hasActorSnapshot(actorId: string): Promise<boolean> {
  const key = scopedKey(actorId)
  if (!key) return Promise.resolve(false)
  return idbCount('actors', key).then((n) => n > 0)
}

function toStorable(actorId: string, actor: TablemateActor): TablemateActor | undefined {
  try {
    return structuredClone(actor)
  } catch {
    // Non-cloneable values present — strip them via JSON.
  }
  try {
    return JSON.parse(JSON.stringify(actor)) as TablemateActor
  } catch (e) {
    logger.debug('actorCache: snapshot not serializable', actorId, e)
    return undefined
  }
}

export async function saveActorSnapshot(
  actorId: string,
  actor: TablemateActor | undefined
): Promise<void> {
  if (!actor) return
  const key = scopedKey(actorId)
  if (!key) return
  // Produce a plain, IDB-storable copy. structuredClone is fastest but throws
  // (DataCloneError) if the synced actor carries any non-cloneable values —
  // functions, symbols, or class instances tucked into the PF2e payload. Fall
  // back to a JSON round-trip, which simply drops those (the snapshot is
  // display-only data, so that's exactly what we want).
  const snapshot = toStorable(actorId, actor)
  if (!snapshot) return
  await idbPut('actors', key, snapshot)
}
