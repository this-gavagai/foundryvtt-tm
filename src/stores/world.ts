import { shallowRef, ref, type Ref } from 'vue'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import type { Socket } from 'socket.io-client'
import { useServerStore } from '@/stores/server'

const WORLD_REQUEST_TIMEOUT_MS = 5000

export const useWorldStore = defineStore('world', () => {
  const world = shallowRef<GamePF2e | undefined>(undefined)
  // true = world active + authenticated, false = not active or no auth, undefined = pending
  const worldActive = ref<boolean | undefined>(undefined)
  // true = Foundry has a game world loaded (from /api/status, auth-independent)
  // false = no world loaded, undefined = not yet determined
  const worldRunning = ref<boolean | undefined>(undefined)
  const { getSocket } = useServerStore()

  async function fetchWorldStatus(): Promise<boolean | undefined> {
    try {
      // 3s cap so a flaky cellular network doesn't strand refreshes on the
      // HTTP step. /api/status is normally a sub-100ms call.
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      const resp = await fetch(`${window.location.origin}/api/status`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      if (!resp.ok) return undefined
      const data = await resp.json()
      return typeof data?.active === 'boolean' ? data.active : undefined
    } catch {
      return undefined
    }
  }

  async function sendWorldRequest(): Promise<Ref<GamePF2e>> {
    // Check /api/status first — works regardless of auth state.
    const running = await fetchWorldStatus()
    if (running !== undefined) worldRunning.value = running

    if (running === false) {
      // Foundry confirmed no world is loaded; skip the socket round-trip.
      worldActive.value = false
      return world as Ref<GamePF2e>
    }

    // World is running (or status check failed) — try to get world data via socket.
    let socket
    try {
      socket = await getSocket()
    } catch {
      // Don't downgrade worldActive on transient socket failures — the last-
      // known state stays visible until a healthy round-trip arrives.
      return world as Ref<GamePF2e>
    }
    return new Promise<Ref<GamePF2e>>((resolve) => {
      // Timeout only resolves the promise — it does NOT flip worldActive.
      // The previous behavior set worldActive=false on timeout, which forced
      // the spinner up whenever a stale-socket call timed out, even if a
      // parallel refresh against a healthy socket had already succeeded. The
      // healthy round-trip will overwrite the world ref when it eventually
      // lands (via socket.io's ack buffering on auto-reconnect, or via the
      // next refresh fired off the session event).
      const timer = setTimeout(() => resolve(world as Ref<GamePF2e>), WORLD_REQUEST_TIMEOUT_MS)

      socket.emit('world', (r: GamePF2e) => {
        clearTimeout(timer)
        // A valid world response always includes a userId. An empty object or
        // a response without userId means the world is not active.
        worldActive.value = !!(r?.userId)
        if (r?.userId) world.value = r
        resolve(world as Ref<GamePF2e>)
      })
    })
  }

  const debouncedWorldRequest = debounce(sendWorldRequest, 2000, { leading: true, trailing: false })
  const refreshWorld = () => debouncedWorldRequest()

  // Fire an immediate world refresh so worldRunning gets a definite value
  // (via /api/status, which doesn't need auth) before the spinner has a
  // chance to camp on `undefined`. Without this, a PWA cold-launch where
  // the socket connects but the `session` event is slow leaves the app
  // stuck on the spinner — App.vue's userId watch is the only other path
  // that calls refreshWorld, and it short-circuits while userId is empty.
  refreshWorld()

  // Lightweight status poll: hits /api/status every 8s (HTTP only, no socket
  // traffic). Immediately marks the world inactive when Foundry reports
  // active:false; triggers a full refresh whenever the status flips up
  // (both `false → true` and `undefined → true`).
  setInterval(async () => {
    const running = await fetchWorldStatus()
    if (running === false && worldRunning.value !== false) {
      worldRunning.value = false
      worldActive.value = false
    } else if (running === true && worldRunning.value !== true) {
      refreshWorld()
    }
  }, 8000)

  // (Visibility-return refresh is owned by App.vue, which probes the socket
  // first and force-reconnects if dead. Routing visibility through there
  // avoids a race where this store's listener would fire refreshWorld on a
  // stale socket before App.vue's probe got a chance to replace it.)

  // Foundry broadcasts 'progress' events while loading a world. Listen for
  // them to detect an in-progress world load (independent of auth state):
  // reset worldActive to undefined so the spinner shows during loading, then
  // fire refreshWorld() on the trailing edge once events stop arriving.
  const onProgressTrailing = debounce(() => refreshWorld(), 2000, { leading: false, trailing: true })
  getSocket().then((s: Socket) => {
    s.on('progress', () => {
      worldActive.value = undefined
      worldRunning.value = undefined
      onProgressTrailing()
    })
  })

  return { world, worldActive, worldRunning, refreshWorld }
})
