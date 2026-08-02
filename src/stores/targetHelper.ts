import { ref, computed, watch, onScopeDispose } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useStorage } from '@vueuse/core'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'
import { useServerAddressStore } from '@/stores/serverAddress'
import { updateUserTargetingProxy } from '@/api/documents'
import { requestTargets } from '@/api/actionRpc'
import type { MirroredTargets } from '@/types/api-types'
import type { UserPF2e } from '@7h3laughingman/pf2e-types'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'
import { logger } from '@/utils/utilities'

// The tablet has no canvas, so it cannot target: it MIRRORS another Foundry
// user's target selection. That user is the "targeting proxy" — a shared display
// the whole table reads, or a player's own second login. The relationship is
// strictly read-only; nothing here ever drives the proxy's client.
//
// One source of truth: the proxy's own client self-reports (SHARE_TARGETS),
// because a user's targets are a set of placed Tokens on that client's canvas
// and only that client can enumerate them without loss. We deliberately do NOT
// also listen to core Foundry's `userActivity` targets, nor to a table-wide map
// rebuilt on the GM's canvas — both were lower-fidelity views of the same state
// that arrived later and overwrote the good one.

function isTablemateRootUser(user: UserPF2e): boolean {
  return user.flags?.tablemate?.character_sheet === 'root'
}

const NO_TARGETS: MirroredTargets = { sceneId: null, tokenIds: [] }

export const useTargetHelperStore = defineStore('targetHelper', () => {
  const worldStore = useWorldStore()
  const { world } = storeToRefs(worldStore)
  const { userById } = worldStore
  const userStore = useUserStore()
  const { userId } = storeToRefs(userStore)
  const { getUserId } = userStore

  const { serverUrl } = storeToRefs(useServerAddressStore())

  // This device's own choice of proxy, kept per (server, signed-in user).
  //
  // It used to be one unscoped 'proxy-id' string, which is wrong on both axes a
  // tablet actually moves along: a second player signing into the same tablet
  // inherited the first one's proxy (silently, if that id happens to name a user
  // of the world they joined), and the value followed the device across servers
  // into worlds it means nothing in. The scope key confines it to the pairing it
  // was chosen for; anything else falls through to the user's own stored flag.
  const localProxyByScope = useStorage<Record<string, string>>('proxy-id-by-scope', {})
  const localScope = computed(() =>
    serverUrl.value?.origin && userId.value ? `${serverUrl.value.origin}|${userId.value}` : ''
  )
  // undefined = this device has no opinion for the current pairing; '' = it has
  // one and the answer is "none". The difference matters: a device that cleared
  // its proxy must not fall back to the stored flag it just tried to clear (the
  // write can fail — see updateProxyId).
  const localProxyId = computed(() =>
    localScope.value ? localProxyByScope.value[localScope.value] : undefined
  )

  const targets = ref<MirroredTargets>(NO_TARGETS)

  const userList = computed(
    () =>
      world.value?.users
        .filter((u: UserPF2e) => !isTablemateRootUser(u))
        .map((u: UserPF2e) => ({ id: u._id ?? undefined, name: u.name })) ?? []
  )

  const storedProxyId = computed(
    () => userById(userId.value)?.flags?.tablemate?.targeting_proxy as string | undefined
  )

  const proxyIsSelectable = computed(() => (proxyId: string | undefined) => {
    const user = userById(proxyId)
    return !!user && !isTablemateRootUser(user)
  })

  // This device's choice wins where it has one — a tablet may deliberately mirror
  // a different screen than its user's default (the shared-TV table vs. the
  // player's own second login). The stored flag is the cross-device default for
  // everywhere that device hasn't been told otherwise.
  const targetingProxyId = computed(() => {
    const chosen = localProxyId.value ?? storedProxyId.value
    return proxyIsSelectable.value(chosen) ? chosen : undefined
  })

  function updateProxyId(newId: string): Promise<DocumentSocketResponse | null> {
    logger.debug('TM-info: newID incoming', newId)
    if (!world.value) return Promise.resolve(null)
    if (newId && !proxyIsSelectable.value(newId)) return Promise.resolve(null)
    // Local first and unconditionally: the flag write is a round-trip that can
    // fail (a world that denies the update, a dropped socket), and the tap must
    // still take effect on the device the user tapped.
    if (localScope.value) localProxyByScope.value[localScope.value] = newId
    return updateUserTargetingProxy(getUserId(), newId)
  }

  function updateTargets(user: string, next: MirroredTargets) {
    if (user === targetingProxyId.value) {
      targets.value = next
    }
  }

  function getTargets(): MirroredTargets {
    return targets.value
  }

  // Drop everything we know about targeting. Called on proxy change and on
  // switching user/server: mirrored state belongs to one proxy in one world, and
  // acting on a set we inherited from a proxy we no longer mirror is worse than
  // acting on none — the roll looks normal either way (see
  // TM_ERROR_TARGET_UNRESOLVED for why we now refuse rather than guess).
  function reset() {
    targets.value = NO_TARGETS
  }

  // Throw away what we hold and ask the proxy for the truth. Clearing and
  // re-requesting are two halves of one event: whatever we held belonged to the
  // old proxy / old world, and the new answer may predate us entirely — a tablet
  // that connects mid-session would otherwise show nothing until the proxy
  // happens to re-target.
  //
  // Clearing FIRST means a roll fired in the gap before the answer lands is
  // untargeted rather than aimed at a stale set — the same trade the reset
  // comment above describes, and cheap now that an untargeted request can no
  // longer pick up the handling GM's own reticle (see utils/target.ts).
  function resync() {
    reset()
    const proxyId = targetingProxyId.value
    if (proxyId) void requestTargets(proxyId)
  }

  // A SHARE_TARGETS push only reaches a connected tablet. Every gap in that
  // connection — socket.io's own reconnects, and above all a mobile app
  // backgrounded long enough for iOS to suspend its socket — is a window in
  // which the proxy re-targeted and we never heard, leaving us holding ids that
  // still resolve. So re-ask on every session handshake and on every return to
  // the foreground, the way the presence heartbeat already re-pings.
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') resync()
  }

  // The proxy's client going away does NOT clear its targets: nothing is
  // broadcast on disconnect, so the last report we hold would keep aiming rolls
  // at tokens no one at the table can see highlighted any more. Foundry's
  // userActivity carries the presence flip; targets are the one thing we must
  // drop when the client that owned them is gone.
  //
  // `active` is absent on ordinary activity broadcasts (cursor, ruler), so only
  // an explicit boolean counts as a presence change.
  function reportUserActivity(userId: string, active: boolean | undefined) {
    if (active === undefined) return
    if (userId !== targetingProxyId.value) return
    // Coming back: ask rather than wait for its next re-target. It answers with
    // an empty set if it has none, which is also the right answer.
    if (active) resync()
    else reset()
  }

  let started = false
  let stopProxyWatch: (() => void) | undefined
  function start(): void {
    if (started) return
    started = true
    // `immediate` covers the cold start: targetingProxyId resolves only once the
    // world payload lands and names the proxy user, so the first meaningful run
    // is the one that fires when the world arrives.
    stopProxyWatch = watch(targetingProxyId, resync, { immediate: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  onScopeDispose(() => {
    stopProxyWatch?.()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    targets,
    getTargets,
    userList,
    targetingProxyId,
    updateProxyId,
    updateTargets,
    reportUserActivity,
    reset,
    resync,
    start
  }
})
