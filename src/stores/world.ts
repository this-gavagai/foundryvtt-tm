import { shallowRef, ref, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { Socket } from 'socket.io-client'
import { useServerStore } from '@/stores/server'

const STATUS_FETCH_TIMEOUT_MS = 3000
const REFRESH_DEBOUNCE_MS = 2000
const POLL_INTERVAL_MS = 8000

export const useWorldStore = defineStore('world', () => {
  const world = shallowRef<GamePF2e | undefined>(undefined)
  // worldAuthenticated: true = world loaded + authenticated, false = not active or no auth, undefined = pending
  const worldAuthenticated = ref<boolean | undefined>(undefined)
  // worldLoaded: true = Foundry has a game world loaded (from /api/status, auth-independent); false = no world loaded, undefined = not yet determined
  const worldLoaded = ref<boolean | undefined>(undefined)

  async function fetchWorldStatus(): Promise<boolean | undefined> {
    // 3s cap so a flaky cellular network doesn't strand refreshes on the
    // HTTP step. /api/status is normally a sub-100ms call.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(`${window.location.origin}/api/status`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      if (!resp.ok) return undefined
      const data = await resp.json()
      return typeof data?.active === 'boolean' ? data.active : undefined
    } catch {
      clearTimeout(timeoutId)
      return undefined
    }
  }

  async function sendWorldRequest(): Promise<void> {
    // Check /api/status first — works regardless of auth state.
    const running = await fetchWorldStatus()
    if (running === false) {
      worldLoaded.value = false
      worldAuthenticated.value = false
      return
    }
    if (running === true) worldLoaded.value = true

    // World is running (or status check failed) — try to get world data via socket.
    // Don't downgrade worldAuthenticated on transient socket failures — the
    // last-known state stays visible until a healthy round-trip arrives.
    const socket = await useServerStore()
      .getSocket()
      .catch(() => null)
    if (!socket) return

    socket.emit('world', (r: GamePF2e) => {
      // A valid world response always includes a userId. An empty object or
      // a response without userId means the world is not active.
      worldAuthenticated.value = !!r?.userId
      if (r?.userId) world.value = r
    })
  }

  // Fire an immediate world refresh so worldLoaded gets a definite value
  // (via /api/status, which doesn't need auth) before the spinner has a
  // chance to camp on `undefined`. Without this, a PWA cold-launch where
  // the socket connects but the `session` event is slow leaves the app
  // stuck on the spinner — App.vue's userId watch is the only other path
  // that calls refreshWorld, and it short-circuits while userId is empty.
  const refreshWorld = debounce(sendWorldRequest, REFRESH_DEBOUNCE_MS, {
    leading: true,
    trailing: false
  })
  const refreshWorldNow = sendWorldRequest
  refreshWorld()

  // Lightweight status poll: hits /api/status every 8s (HTTP only, no socket
  // traffic). Immediately marks the world inactive when Foundry reports
  // active:false; triggers a full refresh whenever the status flips up
  // (both `false → true` and `undefined → true`).
  const pollInterval = setInterval(async () => {
    const running = await fetchWorldStatus()
    if (running === false && worldLoaded.value !== false) {
      worldLoaded.value = false
      worldAuthenticated.value = false
    } else if (running === true && worldLoaded.value !== true) {
      refreshWorld()
    }
  }, POLL_INTERVAL_MS)
  onScopeDispose(() => clearInterval(pollInterval))

  // Foundry broadcasts 'progress' events while loading a world. Listen for
  // them to detect an in-progress world load (independent of auth state):
  // reset worldAuthenticated to undefined so the spinner shows during loading,
  // then fire refreshWorld() on the trailing edge once events stop arriving.
  useServerStore()
    .getSocket()
    .then((s: Socket) => {
      let progressTimer: ReturnType<typeof setTimeout> | undefined
      s.on('progress', () => {
        worldAuthenticated.value = undefined
        worldLoaded.value = undefined
        clearTimeout(progressTimer)
        progressTimer = setTimeout(() => refreshWorld(), REFRESH_DEBOUNCE_MS)
      })
    })
    .catch(() => undefined)

  return { world, worldAuthenticated, worldLoaded, refreshWorld, refreshWorldNow }
})
