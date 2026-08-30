import { ref, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useWorldStore } from '@/stores/world'

const STATUS_FETCH_TIMEOUT_MS = 3000
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

  // `undefined` is a real argument here, not just the initial value: dropping
  // the world payload (a user switch) has to put this back to "pending", or a
  // stale `true` outlives the data it was derived from.
  function setWorldAuthenticated(authenticated: boolean | undefined) {
    worldAuthenticated.value = authenticated
  }

  // Lightweight status poll: hits /api/status every 8s (HTTP only, no socket
  // traffic). Immediately marks the world inactive when Foundry reports
  // active:false; triggers a full refresh whenever the status flips up
  // (both `false -> true` and `undefined -> true`).
  //
  // Started explicitly (idempotent) rather than on first use(), so a unit test
  // can instantiate the store without spawning an 8s network poll. The
  // disposal stays scope-bound below, clearing whatever start() created.
  let pollInterval: ReturnType<typeof setInterval> | undefined
  let started = false
  function start(): void {
    if (started) return
    started = true
    pollInterval = setInterval(async () => {
      const running = await fetchWorldStatus()
      const worldStore = useWorldStore()
      if (running === false && worldLoaded.value !== false) {
        markWorldInactive()
      } else if (
        running === true &&
        !worldStore.requestInFlight &&
        // Retrying on `worldLoaded !== true` alone left the one case that most
        // needs it uncovered: sendWorldRequest sets worldLoaded from
        // /api/status *before* asking for the payload, so a request that then
        // times out leaves the flag true with no world data and nothing to ask
        // again. The remaining triggers (session handshake, world-progress
        // edge, visibility resume) don't fire in a foregrounded app on a live
        // socket, so the app sat there. Retry on the data being missing, which
        // is the condition actually being waited on, and stop once it lands.
        (worldLoaded.value !== true || !worldStore.world)
      ) {
        worldStore.refreshWorld()
      }
    }, POLL_INTERVAL_MS)
  }
  onScopeDispose(() => {
    if (pollInterval) clearInterval(pollInterval)
  })

  // The world-load 'progress' listener is registered in socketSetup
  // (setupSocketListenersForApp) so it re-attaches on every socket swap.

  return {
    worldAuthenticated,
    worldLoaded,
    fetchWorldStatus,
    markWorldLoaded,
    markWorldInactive,
    markWorldPending,
    setWorldAuthenticated,
    start
  }
})
