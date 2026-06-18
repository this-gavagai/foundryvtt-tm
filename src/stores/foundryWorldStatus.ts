import { ref, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import type { Socket } from 'socket.io-client'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useServerStore } from '@/stores/server'
import { useWorldStore } from '@/stores/world'

const STATUS_FETCH_TIMEOUT_MS = 3000
const REFRESH_DEBOUNCE_MS = 2000
const POLL_INTERVAL_MS = 8000

export const useFoundryWorldStatusStore = defineStore('foundryWorldStatus', () => {
  // true = world loaded + authenticated, false = not active or no auth, undefined = pending
  const worldAuthenticated = ref<boolean | undefined>(undefined)
  // true = Foundry has a game world loaded (from /api/status, auth-independent); false = no world loaded, undefined = not yet determined
  const worldLoaded = ref<boolean | undefined>(undefined)

  async function fetchWorldStatus(): Promise<boolean | undefined> {
    const serverUrl = useServerAddressStore().serverUrl
    if (!serverUrl) return undefined
    // 3s cap so a flaky cellular network doesn't strand refreshes on the
    // HTTP step. /api/status is normally a sub-100ms call.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(new URL('/api/status', serverUrl), {
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

  function markWorldLoaded() {
    worldLoaded.value = true
  }

  function markWorldInactive() {
    worldLoaded.value = false
    worldAuthenticated.value = false
  }

  function markWorldPending() {
    worldLoaded.value = undefined
    worldAuthenticated.value = undefined
  }

  function setWorldAuthenticated(authenticated: boolean) {
    worldAuthenticated.value = authenticated
  }

  // Lightweight status poll: hits /api/status every 8s (HTTP only, no socket
  // traffic). Immediately marks the world inactive when Foundry reports
  // active:false; triggers a full refresh whenever the status flips up
  // (both `false -> true` and `undefined -> true`).
  const pollInterval = setInterval(async () => {
    const running = await fetchWorldStatus()
    if (running === false && worldLoaded.value !== false) {
      markWorldInactive()
    } else if (running === true && worldLoaded.value !== true) {
      useWorldStore().refreshWorld()
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
        markWorldPending()
        clearTimeout(progressTimer)
        progressTimer = setTimeout(() => useWorldStore().refreshWorld(), REFRESH_DEBOUNCE_MS)
      })
    })
    .catch(() => undefined)

  return {
    worldAuthenticated,
    worldLoaded,
    fetchWorldStatus,
    markWorldLoaded,
    markWorldInactive,
    setWorldAuthenticated
  }
})
