import { ref, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { getServerTransport } from '@/api/socketConnection'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useWorldStore } from '@/stores/world'

const POLL_INTERVAL_MS = 8000

export const useFoundryWorldStatusStore = defineStore('foundryWorldStatus', () => {
  // true = world loaded + authenticated, false = not active or no auth, undefined = pending
  const worldAuthenticated = ref<boolean | undefined>(undefined)
  // true = Foundry has a game world loaded (from /api/status, auth-independent); false = no world loaded, undefined = not yet determined
  const worldLoaded = ref<boolean | undefined>(undefined)

  // Through the transport rather than the WebView's fetch: on Android the page
  // is https://localhost, which may not fetch from an http:// server, and the
  // spinner waits on this answer.
  async function fetchWorldStatus(): Promise<boolean | undefined> {
    const address = useServerAddressStore()
    const serverUrl = address.serverUrl
    if (!serverUrl) return undefined
    return getServerTransport(address.isNativeMobile).worldActive(serverUrl)
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
