import type { TablemateActor } from '@/types/character-types'
import { idbGet, idbCount, idbPut, idbDeleteByPrefix } from '@/utils/idb'
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
// '|' can appear in neither an origin nor a Foundry actor id, so it's an
// unambiguous delimiter between the two halves of a scoped key.
const KEY_DELIMITER = '|'

function scopedKey(
  actorId: string,
  origin = useServerAddressStore().serverUrl?.origin
): string | undefined {
  if (!origin) return undefined
  return `${origin}${KEY_DELIMITER}${actorId}`
}

// Drop every cached snapshot belonging to a server. Called when the server is
// forgotten so a re-add starts with a clean cache instead of stale characters.
export function clearActorSnapshotsForServer(origin: string): Promise<void> {
  return idbDeleteByPrefix('actors', `${origin}${KEY_DELIMITER}`)
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

// Produce a plain, IDB-storable copy. The synced actor lives in a deeply
// reactive ref, so what arrives here is a Vue Proxy — which the structured
// clone algorithm rejects outright (DataCloneError), before even reaching the
// functions and class instances tucked into the PF2e payload. A JSON
// round-trip handles both: it reads through the proxy and drops
// non-serializable values (the snapshot is display-only data, so that's
// exactly what we want).
function toStorable(actorId: string, actor: TablemateActor): TablemateActor | undefined {
  try {
    return JSON.parse(JSON.stringify(actor)) as TablemateActor
  } catch (e) {
    logger.debug('actorCache: snapshot not serializable', actorId, e)
    return undefined
  }
}

// `origin` is passed by the caller, captured *before* any deferral (the save
// sits behind a debounce): resolving it here at write time would let a server
// switch mid-debounce file the old server's actor under the new server's key —
// exactly the cross-server bleed the per-origin scoping exists to prevent.
export async function saveActorSnapshot(
  actorId: string,
  actor: TablemateActor | undefined,
  origin: string
): Promise<void> {
  if (!actor) return
  const key = scopedKey(actorId, origin)
  if (!key) return
  const snapshot = toStorable(actorId, actor)
  if (!snapshot) return
  await idbPut('actors', key, snapshot)
}
