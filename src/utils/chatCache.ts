import type { ChatMessageData } from '@/composables/useChatMessages'
import { idbGet, idbPut } from '@/utils/idb'
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
const MAX_CACHED_MESSAGES = 200

export function loadCachedChatMessages(userId: string): Promise<ChatMessageData[] | undefined> {
  if (!userId) return Promise.resolve(undefined)
  return idbGet<ChatMessageData[]>('chat', userId)
}

export async function saveCachedChatMessages(
  userId: string,
  messages: ChatMessageData[]
): Promise<void> {
  if (!userId) return
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
  await idbPut('chat', userId, storable)
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
  return idbGet<number>('chat', readMarkerKey(userId))
}

export async function saveChatReadMarker(userId: string, timestamp: number): Promise<void> {
  if (!userId) return
  await idbPut('chat', readMarkerKey(userId), timestamp)
}
