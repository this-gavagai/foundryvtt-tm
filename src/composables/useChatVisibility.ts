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

// The message's real `author` — the Foundry user the SERVER recorded as having
// created it, which is the only id its write permissions are decided against.
// Serialized either as a bare id or as an expanded object depending on where the
// payload came from, so both are accepted.
//
// Deliberately not the same question as "is this message mine?" — see
// messageIsFromCurrentUser below, which widens across the tablemate origin flag
// and the belongsTo pair for attribution. Anything that decides whether a WRITE
// will be permitted has to ask this one instead.
export function messageAuthorId(message: ChatMessageData): string | undefined {
  const author = message.author
  return (typeof author === 'string' ? author : author?._id) ?? undefined
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
    const authorId = messageAuthorId(message)
    return !!authorId && ids.has(authorId)
  }

  // Whether a message is this client's for DISPLAY purposes — right-alignment,
  // grouping, and not counting as unread. Widened on purpose, across both the
  // tablemate origin flag and the belongsTo pair: a roll the app made is the
  // player's roll however it reached the log.
  //
  // NOT a permission test. A card the GM's client posted on the player's behalf
  // answers true here while its `author` is the GM, so anything gated on whether
  // Foundry will accept a write must ask messageAuthoredByCurrentUser instead.
  function messageIsFromCurrentUser(message: ChatMessageData): boolean {
    const ids = currentUserIds.value
    if (!ids.size) return false
    const origin = message.flags?.tablemate?.originUserId
    if (typeof origin === 'string' && ids.has(origin)) return true
    const authorId = messageAuthorId(message)
    return !!authorId && ids.has(authorId)
  }

  // Whether Foundry considers this client the message's author — the exact test
  // its update and delete permissions are decided by (`user.isGM || author ===
  // user.id`), so it is what an edit or delete affordance has to be gated on.
  //
  // Exact match on the logged-in id, deliberately not the belongsTo-widened set:
  // a linked identity is a different Foundry user, and the server refuses a
  // write to another user's message however related the two people are. Same
  // reasoning as a reaction's `mine`.
  function messageAuthoredByCurrentUser(message: ChatMessageData): boolean {
    const userId = userStore.userId
    return !!userId && messageAuthorId(message) === userId
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
    messageAuthoredByCurrentUser,
    liveMessages,
    visibleMessages
  }
}
