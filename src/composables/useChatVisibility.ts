import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import type { ChatMessageData } from '@/composables/useChatMessages'

export interface UserData {
  _id?: string | null
  id?: string | null
  name?: string | null
  flags?: {
    tablemate?: {
      belongsTo?: string | null
    }
  }
}

function byTimestamp(a: ChatMessageData, b: ChatMessageData): number {
  return (a.timestamp ?? 0) - (b.timestamp ?? 0)
}

// Shared whisper/visibility gating for the chat overlay (full message list) and
// the unread store (badge count). Both must filter identically so the badge
// never counts a message the overlay would hide. Mirrors Foundry's own
// ChatMessage#visible: a whispered message is only visible to its recipients,
// its author, and the GM; a message with no whisper list is public.
export function useChatVisibility() {
  const { world } = storeToRefs(useWorldStore())
  const userStore = useUserStore()

  const users = computed(() =>
    collectionToArray<UserData>(world.value?.users as CollectionLike<UserData>)
  )

  const currentUserIsGM = computed(() => {
    const userId = (world.value as { userId?: string } | undefined)?.userId
    if (!userId) return false
    const user = collectionToArray<{ _id?: string | null; role?: number }>(
      world.value?.users as CollectionLike<{ _id?: string | null; role?: number }>
    ).find((u) => u._id === userId)
    return (user?.role ?? 0) >= 4
  })

  // The set of Foundry user ids this client "is" for whisper purposes: the
  // logged-in sheet user plus, if configured, the human login user it Belongs
  // To (set GM-side via the User Select menu).
  const currentUserIds = computed(() => {
    const ids = new Set<string>()
    const userId = userStore.userId
    if (!userId) return ids
    ids.add(userId)
    const self = users.value.find((u) => u._id === userId || u.id === userId)
    const owner = self?.flags?.tablemate?.belongsTo
    if (typeof owner === 'string' && owner) ids.add(owner)
    return ids
  })

  function messageVisibleToCurrentUser(message: ChatMessageData): boolean {
    const recipients = message.whisper
    if (!recipients?.length) return true
    if (currentUserIsGM.value) return true
    const ids = currentUserIds.value
    if (!ids.size) return false
    if (recipients.some((recipient) => ids.has(recipient))) return true
    const authorId = typeof message.author === 'string' ? message.author : message.author?._id
    return !!authorId && ids.has(authorId)
  }

  // Whether a message was authored by this client (own posts shouldn't count as
  // unread). Checks both the tablemate origin flag and the raw author id.
  function messageIsFromCurrentUser(message: ChatMessageData): boolean {
    const ids = currentUserIds.value
    if (!ids.size) return false
    const origin = message.flags?.tablemate?.originUserId
    if (typeof origin === 'string' && ids.has(origin)) return true
    const authorId = typeof message.author === 'string' ? message.author : message.author?._id
    return !!authorId && ids.has(authorId)
  }

  // Plain function, NOT a computed: new messages are pushed into world.messages
  // in place and surfaced via triggerRef(world), so the underlying array keeps
  // the same reference. Reading world.value here makes the computed below depend
  // on the ref that triggerRef notifies, while returning a fresh array each call.
  const liveMessages = () =>
    collectionToArray<ChatMessageData>(world.value?.messages as CollectionLike<ChatMessageData>)

  // Live, filtered, time-sorted messages from the world payload (no cache
  // fallback — callers that need a cold-launch placeholder layer that on top).
  const visibleMessages = computed(() =>
    liveMessages().filter(messageVisibleToCurrentUser).sort(byTimestamp)
  )

  return {
    currentUserIsGM,
    currentUserIds,
    messageVisibleToCurrentUser,
    messageIsFromCurrentUser,
    liveMessages,
    visibleMessages
  }
}
