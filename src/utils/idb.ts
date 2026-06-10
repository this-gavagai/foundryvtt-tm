import { logger } from '@/utils/utilities'

// Shared IndexedDB plumbing for the offline snapshot caches (actor sheets,
// chat). A single key/value database with one object store per data kind, so a
// reactivated PWA can paint last-known state instantly while the live socket
// fetch catches up. All operations degrade silently to a no-op if IndexedDB is
// unavailable (private mode, quota, etc.) — caching is best-effort.

const DB_NAME = 'tablemate'
// Bumped to 2 to add the 'chat' store alongside the original 'actors' store.
const DB_VERSION = 2
const STORE_NAMES = ['actors', 'chat'] as const
export type StoreName = (typeof STORE_NAMES)[number]

let dbPromise: Promise<IDBDatabase | undefined> | undefined

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        for (const name of STORE_NAMES) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        logger.debug('idb: failed to open', req.error)
        resolve(undefined)
      }
    } catch (e) {
      logger.debug('idb: unavailable', e)
      resolve(undefined)
    }
  })
  return dbPromise
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

// Counts the key rather than deserializing the value — a cheap existence check.
export async function idbCount(store: StoreName, key: string): Promise<number> {
  const db = await openDb()
  if (!db) return 0
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).count(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(0)
    } catch {
      resolve(0)
    }
  })
}

export async function idbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => {
        logger.debug('idb: put failed', store, key, tx.error)
        resolve()
      }
    } catch (e) {
      logger.debug('idb: put failed', store, key, e)
      resolve()
    }
  })
}
