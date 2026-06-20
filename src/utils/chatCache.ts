import type { ChatMessageData } from '@/composables/useChatMessages'
import { idbGet, idbPut, idbDeleteByPrefix } from '@/utils/idb'
import { useServerAddressStore } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'

// Persists the most recent chat messages the current user can see so a
// reactivated PWA can paint the chat overlay instantly instead of an empty log
// while the world payload is still in flight (stale-while-revalidate).
//
// Keyed by user id: the world response is already filtered server-side to what
// the user is allowed to see (whispers, blind rolls), so caching per user keeps
// another login on the same device from reading back messages that weren't
// theirs. Only the tail is kept — older history isn't worth the storage/parse
// cost, and the live fetch fills it back in within the handshake.
//
// The key is *also* scoped to the active server's origin: Foundry user ids are
// world-local, so two servers (e.g. a copied world) can share one — without the
// origin prefix that would leak one server's whispers/blind rolls onto another.
const MAX_CACHED_MESSAGES = 200

// Prefix a cache key with the active server origin. Returns undefined when no
// server is active (the gate is showing); callers treat that as a cache miss /
// no-op. '|' appears in neither an origin nor a Foundry user id.
const KEY_DELIMITER = '|'

function scopedKey(key: string): string | undefined {
  const origin = useServerAddressStore().serverUrl?.origin
  if (!origin) return undefined
  return `${origin}${KEY_DELIMITER}${key}`
}

// Drop every cached chat entry (messages + read markers) for a server. Called
// when the server is forgotten so a re-add starts with an empty chat log.
export function clearChatCacheForServer(origin: string): Promise<void> {
  return idbDeleteByPrefix('chat', `${origin}${KEY_DELIMITER}`)
}

export function loadCachedChatMessages(userId: string): Promise<ChatMessageData[] | undefined> {
  if (!userId) return Promise.resolve(undefined)
  const key = scopedKey(userId)
  if (!key) return Promise.resolve(undefined)
  return idbGet<ChatMessageData[]>('chat', key)
}

export async function saveCachedChatMessages(
  userId: string,
  messages: ChatMessageData[]
): Promise<void> {
  if (!userId) return
  const key = scopedKey(userId)
  if (!key) return
  const tail = messages.slice(-MAX_CACHED_MESSAGES)
  let storable: ChatMessageData[]
  try {
    storable = structuredClone(tail)
  } catch {
    // Chat payloads can carry non-cloneable bits (e.g. a getFlag method on a
    // live document); strip them via JSON, which is all the renderer needs.
    try {
      storable = JSON.parse(JSON.stringify(tail)) as ChatMessageData[]
    } catch (e) {
      logger.debug('chatCache: messages not serializable', e)
      return
    }
  }
  await idbPut('chat', key, storable)
}

// The "last read" watermark: the timestamp of the newest chat message the user
// has actually seen (scrolled to). Persisted per user alongside the message
// cache (in the same 'chat' store, under a `read:` key prefix so it never
// collides with the cached message array) so that a player returning after time
// away — or after a PWA relaunch — can be shown exactly which messages arrived
// while they were gone. Same keying rules as the message cache: the Foundry
// user _id, falling back to the last-known persisted id on a cold launch.
function readMarkerKey(userId: string): string {
  return `read:${userId}`
}

export function loadChatReadMarker(userId: string): Promise<number | undefined> {
  if (!userId) return Promise.resolve(undefined)
  const key = scopedKey(readMarkerKey(userId))
  if (!key) return Promise.resolve(undefined)
  return idbGet<number>('chat', key)
}

export async function saveChatReadMarker(userId: string, timestamp: number): Promise<void> {
  if (!userId) return
  const key = scopedKey(readMarkerKey(userId))
  if (!key) return
  await idbPut('chat', key, timestamp)
}
