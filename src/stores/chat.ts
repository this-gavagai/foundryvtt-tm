import { computed, ref, watch } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { debounce } from 'lodash-es'
import { useUserStore, lastKnownUserId } from '@/stores/user'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useWorldStore } from '@/stores/world'
import { useChatVisibility } from '@/composables/useChatVisibility'
import {
  loadCachedChatMessages,
  saveCachedChatMessages,
  loadChatReadMarker,
  saveChatReadMarker
} from '@/utils/chatCache'
import type { ChatMessageData } from '@/composables/useChatMessages'

// Owns everything "chat that outlives the session":
//   1. The cold-launch message cache — the last-seen tail hydrated from
//      IndexedDB so the overlay can paint instantly while the world payload is
//      in flight, and the debounced write-back that keeps it current.
//   2. The read watermark — which messages the user has already seen, powering
//      the unread badge and the "new messages" divider in the overlay.
//
// Both live here (a Pinia singleton) rather than in useChatMessages: that
// composable is instantiated once per mounted character sheet, so keeping the
// IDB side effects there meant N duplicate cold-start reads and N duplicate
// debounced writes per message burst.
//
// The watermark is the timestamp of the newest message the user has actually
// scrolled to. It is persisted per Foundry user (see chatCache) so it survives
// reloads and PWA relaunches — that's what makes "came back online after being
// away" work. The live message list comes from the same useChatVisibility used
// by the overlay, so the badge count can never disagree with what's shown.
export const useChatStore = defineStore('chat', () => {
  const userStore = useUserStore()
  const serverAddressStore = useServerAddressStore()
  const worldStore = useWorldStore()
  const { world, messagesRevision } = storeToRefs(worldStore)

  // Cache reads may fall back to the last-known persisted user id so they can
  // resolve before the session handshake repopulates the store. Writes must
  // NOT: a guessed id would file this user's server-filtered data under
  // another user's key. Write paths gate on `userStore.userId` directly.
  const cacheKey = () => userStore.userId || lastKnownUserId()
  const activeOrigin = () => serverAddressStore.serverUrl?.origin

  const { visibleMessages, liveMessages, messageIsFromCurrentUser } = useChatVisibility()

  // ── Cold-launch message cache ─────────────────────────────────────────────

  // Stale-while-revalidate placeholder: the last-seen tail from IndexedDB.
  // Consumers (useChatMessages) show this only until the world payload
  // arrives, and re-filter it through the visibility rules at render time.
  const cachedMessages = ref<ChatMessageData[]>([])

  // Newest message the user has seen. null = not hydrated yet.
  const lastReadTimestamp = ref<number | null>(null)
  // Frozen copy of the watermark captured when the overlay opens, so the "new
  // messages" divider holds its position as fresh messages stream in during the
  // session instead of sliding down with every arrival.
  const dividerTimestamp = ref<number | null>(null)
  // Which origin|user scope the current watermark was loaded for (guards
  // re-hydration).
  const hydratedKey = ref('')
  // Set when no stored watermark exists (new device/user): defer establishing a
  // baseline until messages have actually loaded, so we baseline to "newest" and
  // don't flag the whole backlog as unread on first run.
  const needsBaseline = ref(false)

  async function hydrate(origin: string, key: string): Promise<void> {
    const scope = `${origin}|${key}`
    if (hydratedKey.value === scope) return
    hydratedKey.value = scope
    // Drop the previous scope's tail immediately rather than showing it while
    // the new read is in flight.
    cachedMessages.value = []
    const [cached, stored] = await Promise.all([
      loadCachedChatMessages(key),
      loadChatReadMarker(key)
    ])
    // The scope may have moved on while the reads were in flight.
    if (hydratedKey.value !== scope) return
    if (cached?.length) cachedMessages.value = cached
    if (stored != null) {
      lastReadTimestamp.value = stored
      needsBaseline.value = false
    } else {
      lastReadTimestamp.value = null
      needsBaseline.value = true
    }
  }

  // Hydrate as soon as an origin + user id are known, and re-hydrate when
  // either changes (cold launch, user switch, server switch — Foundry user ids
  // are world-local, so the same id on another origin is a different scope).
  watch(
    () => [activeOrigin(), cacheKey()] as const,
    ([origin, key]) => {
      if (origin && key) void hydrate(origin, key)
    },
    { immediate: true }
  )

  // ── Cache write-back ──────────────────────────────────────────────────────

  // Persist the live (server-filtered) tail so the next cold launch has it,
  // debounced so a burst of arrivals collapses into one IDB write. userId and
  // origin are captured at queue time: the session-confirmed user id (never
  // the lastKnownUserId guess), and the origin as of when the messages were
  // read (so a server switch mid-debounce can't re-key them).
  const persist = debounce((userId: string, msgs: ChatMessageData[], origin: string) => {
    void saveCachedChatMessages(userId, msgs, origin)
  }, 1000)
  function queuePersist(): void {
    const userId = userStore.userId
    const origin = activeOrigin()
    if (!userId || !origin) return
    const live = liveMessages()
    if (!live.length) return
    persist(userId, live, origin)
  }

  // Two triggers, covering different change shapes:
  //   • A content fingerprint (mutation revision + count + tail identity) for
  //     socket-time changes. The revision counter is what catches in-place
  //     *updates* to older messages, which change neither count nor tail. A
  //     plain array watch would miss appends entirely — in-place mutation
  //     keeps the same reference.
  //   • The world ref itself for wholesale payload replacement (cold load,
  //     refresh after time away), immediate so a session in which no new
  //     message ever arrives still writes once — otherwise messages deleted or
  //     edited while away would survive in the cache across launches.
  watch(
    () => {
      const live = liveMessages()
      if (!live.length) return ''
      const last = live[live.length - 1]
      return `${messagesRevision.value}:${live.length}:${last?._id ?? ''}:${last?.timestamp ?? ''}`
    },
    (fingerprint) => {
      if (fingerprint) queuePersist()
    }
  )
  // Manual identity guard: world is a shallowRef, and Vue force-triggers
  // shallow-ref watchers on every triggerRef (combat updates included) — this
  // watch is only about wholesale payload replacement.
  let lastSeenWorld: unknown
  watch(
    world,
    (w) => {
      if (w === lastSeenWorld) return
      lastSeenWorld = w
      queuePersist()
    },
    { immediate: true }
  )

  // ── Read watermark ────────────────────────────────────────────────────────

  const latestTimestamp = computed<number | null>(() => {
    const msgs = visibleMessages.value
    return msgs.length ? (msgs[msgs.length - 1].timestamp ?? 0) : null
  })

  // Persist the watermark under the session-confirmed user id only (see
  // cacheKey note above). In practice a watermark only moves once live
  // messages exist, which requires an established session anyway.
  function persistMarker(timestamp: number): void {
    const userId = userStore.userId
    if (userId) void saveChatReadMarker(userId, timestamp)
  }

  // Establish the first-run baseline once messages have loaded: treat the
  // existing backlog as already read so a fresh install doesn't badge everything.
  watch([needsBaseline, latestTimestamp], ([needs, latest]) => {
    if (needs && latest != null) {
      lastReadTimestamp.value = latest
      needsBaseline.value = false
      persistMarker(latest)
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
      persistMarker(latest)
    }
  }

  return {
    cachedMessages,
    lastReadTimestamp,
    dividerTimestamp,
    unreadCount,
    hasUnread,
    isUnread,
    beginSession,
    markAllRead
  }
})
