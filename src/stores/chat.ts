import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useUserStore, lastKnownUserId } from '@/stores/user'
import { useChatVisibility } from '@/composables/useChatVisibility'
import { loadChatReadMarker, saveChatReadMarker } from '@/utils/chatCache'
import type { ChatMessageData } from '@/composables/useChatMessages'

// Tracks which chat messages the user has already seen, so we can:
//   1. Badge the chat entry points (portrait / side menu) with a count of
//      messages that arrived while they were away or had chat unfocused.
//   2. Drop a "new messages" divider in the overlay at the point they left off.
//
// The watermark is the timestamp of the newest message the user has actually
// scrolled to. It is persisted per Foundry user (see chatCache) so it survives
// reloads and PWA relaunches — that's what makes "came back online after being
// away" work. The live message list comes from the same useChatVisibility used
// by the overlay, so the badge count can never disagree with what's shown.
export const useChatStore = defineStore('chat', () => {
  const userStore = useUserStore()
  const cacheKey = () => userStore.userId || lastKnownUserId()

  const { visibleMessages, messageIsFromCurrentUser } = useChatVisibility()

  // Newest message the user has seen. null = not hydrated yet.
  const lastReadTimestamp = ref<number | null>(null)
  // Frozen copy of the watermark captured when the overlay opens, so the "new
  // messages" divider holds its position as fresh messages stream in during the
  // session instead of sliding down with every arrival.
  const dividerTimestamp = ref<number | null>(null)
  // Which user key the current watermark was loaded for (guards re-hydration).
  const hydratedKey = ref('')
  // Set when no stored watermark exists (new device/user): defer establishing a
  // baseline until messages have actually loaded, so we baseline to "newest" and
  // don't flag the whole backlog as unread on first run.
  const needsBaseline = ref(false)

  const latestTimestamp = computed<number | null>(() => {
    const msgs = visibleMessages.value
    return msgs.length ? (msgs[msgs.length - 1].timestamp ?? 0) : null
  })

  async function hydrate(key: string): Promise<void> {
    if (!key || hydratedKey.value === key) return
    hydratedKey.value = key
    const stored = await loadChatReadMarker(key)
    if (stored != null) {
      lastReadTimestamp.value = stored
      needsBaseline.value = false
    } else {
      lastReadTimestamp.value = null
      needsBaseline.value = true
    }
  }

  // Hydrate as soon as a user id is known, and re-hydrate if the user changes.
  watch(
    () => cacheKey(),
    (key) => void hydrate(key),
    { immediate: true }
  )

  // Establish the first-run baseline once messages have loaded: treat the
  // existing backlog as already read so a fresh install doesn't badge everything.
  watch([needsBaseline, latestTimestamp], ([needs, latest]) => {
    if (needs && latest != null) {
      lastReadTimestamp.value = latest
      needsBaseline.value = false
      void saveChatReadMarker(cacheKey(), latest)
    }
  })

  // Count of messages newer than the watermark, excluding the user's own posts
  // (you don't get badged for what you sent).
  const unreadCount = computed(() => {
    const marker = lastReadTimestamp.value
    if (marker == null) return 0
    return visibleMessages.value.filter(
      (m) => (m.timestamp ?? 0) > marker && !messageIsFromCurrentUser(m)
    ).length
  })

  const hasUnread = computed(() => unreadCount.value > 0)

  // True for a message that sits below the frozen divider (i.e. arrived since the
  // user last read) and isn't their own — used for the divider position and the
  // per-row "unread" highlight in the overlay.
  function isUnread(message: ChatMessageData): boolean {
    const divider = dividerTimestamp.value
    if (divider == null) return false
    return (message.timestamp ?? 0) > divider && !messageIsFromCurrentUser(message)
  }

  // Freeze the divider at the current read position. Call when the overlay opens.
  function beginSession(): void {
    dividerTimestamp.value = lastReadTimestamp.value
  }

  // Advance the watermark to the newest visible message and persist it. Called
  // when the overlay is scrolled to the bottom (the user has seen everything).
  function markAllRead(): void {
    const latest = latestTimestamp.value
    if (latest == null) return
    if (lastReadTimestamp.value == null || latest > lastReadTimestamp.value) {
      lastReadTimestamp.value = latest
      needsBaseline.value = false
      void saveChatReadMarker(cacheKey(), latest)
    }
  }

  return {
    lastReadTimestamp,
    dividerTimestamp,
    unreadCount,
    hasUnread,
    isUnread,
    beginSession,
    markAllRead
  }
})
