import type { TablemateCharacter } from '@/types/character-types'
import { idbGet, idbCount, idbPut } from '@/utils/idb'
import { logger } from '@/utils/utilities'

// Persists the last-known character snapshot per actor so a reactivated PWA
// can paint the sheet instantly from disk while the live socket fetch catches
// up in the background (stale-while-revalidate). Keyed by actor id in the
// 'actors' store.

export function loadActorSnapshot(actorId: string): Promise<TablemateCharacter | undefined> {
  return idbGet<TablemateCharacter>('actors', actorId)
}

// Cheap existence check so the UI can decide whether to optimistically paint a
// cached sheet during the initial handshake.
export function hasActorSnapshot(actorId: string): Promise<boolean> {
  return idbCount('actors', actorId).then((n) => n > 0)
}

function toStorable(
  actorId: string,
  actor: TablemateCharacter
): TablemateCharacter | undefined {
  try {
    return structuredClone(actor)
  } catch {
    // Non-cloneable values present — strip them via JSON.
  }
  try {
    return JSON.parse(JSON.stringify(actor)) as TablemateCharacter
  } catch (e) {
    logger.debug('actorCache: snapshot not serializable', actorId, e)
    return undefined
  }
}

export async function saveActorSnapshot(
  actorId: string,
  actor: TablemateCharacter | undefined
): Promise<void> {
  if (!actor) return
  // Produce a plain, IDB-storable copy. structuredClone is fastest but throws
  // (DataCloneError) if the synced actor carries any non-cloneable values —
  // functions, symbols, or class instances tucked into the PF2e payload. Fall
  // back to a JSON round-trip, which simply drops those (the snapshot is
  // display-only data, so that's exactly what we want).
  const snapshot = toStorable(actorId, actor)
  if (!snapshot) return
  await idbPut('actors', actorId, snapshot)
}
