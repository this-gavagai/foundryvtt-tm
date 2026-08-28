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
import { onForeground } from '@/utils/foreground'
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

// How many (server, user) proxy choices this device remembers. A tablet that has
// been pointed at a handful of worlds keeps a working set; beyond that the
// oldest entries are choices for pairings nobody is coming back to.
const MAX_REMEMBERED_SCOPES = 12

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

  // Insertion-ordered, so dropping from the front drops the least recently
  // chosen pairing. Re-choosing for a scope moves it to the back.
  function rememberLocalChoice(scope: string, proxyId: string) {
    const rest = Object.fromEntries(
      Object.entries(localProxyByScope.value).filter(([key]) => key !== scope)
    )
    // Room for the one about to be written, so the cap counts it.
    const overflow = Object.keys(rest).length - (MAX_REMEMBERED_SCOPES - 1)
    for (const key of Object.keys(rest).slice(0, Math.max(0, overflow))) delete rest[key]
    localProxyByScope.value = { ...rest, [scope]: proxyId }
  }

  const targets = ref<MirroredTargets>(NO_TARGETS)

  function isSelectableProxy(proxyId: string | undefined): boolean {
    const user = userById(proxyId)
    return !!user && !isTablemateRootUser(user)
  }

  const userList = computed(
    () =>
      world.value?.users
        .filter((u: UserPF2e) => !isTablemateRootUser(u))
        .map((u: UserPF2e) => ({ id: u._id ?? undefined, name: u.name })) ?? []
  )

  const storedProxyId = computed(
    () => userById(userId.value)?.flags?.tablemate?.targeting_proxy as string | undefined
  )

  // This device's choice wins where it has one — a tablet may deliberately mirror
  // a different screen than its user's default (the shared-TV table vs. the
  // player's own second login). The stored flag is the cross-device default for
  // everywhere that device hasn't been told otherwise.
  const targetingProxyId = computed(() => {
    const chosen = localProxyId.value ?? storedProxyId.value
    return isSelectableProxy(chosen) ? chosen : undefined
  })

  // Whether the proxy's client is connected, as far as we have been told.
  // `undefined` until a presence broadcast names it: the world payload carries
  // no liveness, so "we have not heard" is a third state and must not be
  // rendered as offline.
  const proxyOnline = ref<boolean | undefined>(undefined)
  // A proxy we KNOW is gone. Worth surfacing, because it is otherwise a silent
  // dead end: it answers no report request, so the tablet quietly rolls
  // untargeted with a proxy still named in the menu.
  const proxyOffline = computed(() => !!targetingProxyId.value && proxyOnline.value === false)

  function updateProxyId(newId: string): Promise<DocumentSocketResponse | null> {
    logger.debug('TM-info: newID incoming', newId)
    if (!world.value) return Promise.resolve(null)
    if (newId && !isSelectableProxy(newId)) return Promise.resolve(null)
    // Local first and unconditionally: the flag write is a round-trip that can
    // fail (a world that denies the update, a dropped socket), and the tap must
    // still take effect on the device the user tapped.
    if (localScope.value) rememberLocalChoice(localScope.value, newId)
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

  // Ask the proxy for the truth, keeping what we hold until the answer lands.
  //
  // For the gaps where the proxy has not changed — a socket reconnect, an app
  // returning to the foreground — this is the whole job. What we hold was
  // correct for this proxy in this world when it arrived; it is merely possibly
  // out of date, and clearing it first would open a window in which a roll fired
  // before the answer returns is silently untargeted. If it turns out to be
  // genuinely stale, the module refuses the roll (TM_ERROR_TARGET_UNRESOLVED)
  // and api/actionRpc calls resync below — so the dangerous case is already
  // caught, at the one boundary every targeted request crosses.
  function refresh() {
    const proxyId = targetingProxyId.value
    if (proxyId) void requestTargets(proxyId)
  }

  // Throw away what we hold and ask again. For the changes where what we hold
  // belongs to somebody else: a new proxy, a new world, or a module that has
  // just told us our ids don't resolve. Here the stale set is not merely old but
  // wrong, and rolling at it is worse than rolling at nothing.
  function resync() {
    reset()
    refresh()
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
    proxyOnline.value = active
    // Coming back: ask rather than wait for its next re-target. It answers with
    // an empty set if it has none, which is also the right answer.
    if (active) refresh()
    else reset()
  }

  let started = false
  let stopProxyWatch: (() => void) | undefined
  let stopForeground: (() => void) | undefined
  function start(): void {
    if (started) return
    started = true
    // `immediate` covers the cold start: targetingProxyId resolves only once the
    // world payload lands and names the proxy user, so the first meaningful run
    // is the one that fires when the world arrives.
    stopProxyWatch = watch(
      targetingProxyId,
      () => {
        // A new proxy's liveness is unknown again until it says otherwise.
        proxyOnline.value = undefined
        resync()
      },
      { immediate: true }
    )
    // A SHARE_TARGETS push only reaches a connected tablet, and an app the OS
    // suspended has been unreachable for however long it was away.
    stopForeground = onForeground(refresh)
  }

  onScopeDispose(() => {
    stopProxyWatch?.()
    stopForeground?.()
  })

  return {
    targets,
    getTargets,
    userList,
    targetingProxyId,
    proxyOffline,
    updateProxyId,
    updateTargets,
    reportUserActivity,
    reset,
    refresh,
    resync,
    start
  }
})
