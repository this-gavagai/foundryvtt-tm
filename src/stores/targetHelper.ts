import { ref, computed, watch, onScopeDispose } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useStorage } from '@vueuse/core'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'
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

  const localProxyId = useStorage('proxy-id', '')
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

  const targetingProxyId = computed(() =>
    [localProxyId.value, storedProxyId.value].find((id) => proxyIsSelectable.value(id))
  )

  function updateProxyId(newId: string): Promise<DocumentSocketResponse | null> {
    logger.debug('TM-info: newID incoming', newId)
    if (!world.value) return Promise.resolve(null)
    if (newId && !proxyIsSelectable.value(newId)) return Promise.resolve(null)
    localProxyId.value = newId
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
  function resync() {
    reset()
    const proxyId = targetingProxyId.value
    if (proxyId) void requestTargets(proxyId)
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
  }

  onScopeDispose(() => stopProxyWatch?.())

  return {
    targets,
    getTargets,
    userList,
    targetingProxyId,
    updateProxyId,
    updateTargets,
    reset,
    resync,
    start
  }
})
