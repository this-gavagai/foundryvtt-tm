import type { TablemateCharacter } from '@/types/character-types'
import { logger } from '@/utils/utilities'

// Persists the last-known character snapshot per actor so a reactivated PWA
// can paint the sheet instantly from disk while the live socket fetch catches
// up in the background (stale-while-revalidate). IndexedDB rather than
// localStorage: a full PF2e actor is 100KB+ of JSON, and IDB writes are async
// so saving on every update doesn't jank the main thread.

const DB_NAME = 'tablemate'
const STORE_NAME = 'actors'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase | undefined> | undefined

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        logger.debug('actorCache: failed to open IndexedDB', req.error)
        resolve(undefined)
      }
    } catch (e) {
      logger.debug('actorCache: IndexedDB unavailable', e)
      resolve(undefined)
    }
  })
  return dbPromise
}

export async function loadActorSnapshot(
  actorId: string
): Promise<TablemateCharacter | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(actorId)
      req.onsuccess = () => resolve(req.result as TablemateCharacter | undefined)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

// Cheap existence check (counts the key rather than deserializing the full
// snapshot) so the UI can decide whether to optimistically paint a cached
// sheet during the initial handshake.
export async function hasActorSnapshot(actorId: string): Promise<boolean> {
  const db = await openDb()
  if (!db) return false
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count(actorId)
      req.onsuccess = () => resolve(req.result > 0)
      req.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
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
    logger.info('[actorCache] save skipped: snapshot not serializable', actorId, e)
    return undefined
  }
}

export async function saveActorSnapshot(
  actorId: string,
  actor: TablemateCharacter | undefined
): Promise<void> {
  if (!actor) {
    logger.info('[actorCache] save skipped: no actor data', actorId)
    return
  }
  const db = await openDb()
  if (!db) {
    logger.info('[actorCache] save skipped: no IndexedDB', actorId)
    return
  }
  // Produce a plain, IDB-storable copy. structuredClone is fastest but throws
  // (DataCloneError) if the synced actor carries any non-cloneable values —
  // functions, symbols, or class instances tucked into the PF2e payload. Fall
  // back to a JSON round-trip, which simply drops those (the snapshot is
  // display-only data, so that's exactly what we want). JSON.stringify itself
  // only throws on circular refs, which socket-sourced JSON data won't have.
  const snapshot = toStorable(actorId, actor)
  if (!snapshot) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(snapshot, actorId)
      tx.oncomplete = () => {
        logger.info('[actorCache] saved snapshot', actorId)
        resolve()
      }
      tx.onerror = () => {
        logger.info('[actorCache] save failed (tx error)', actorId, tx.error)
        resolve()
      }
    } catch (e) {
      logger.info('[actorCache] save failed (threw)', actorId, e)
      resolve()
    }
  })
}
