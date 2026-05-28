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
      const resp = await fetch(`${window.location.origin}/api/status`)
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
      worldActive.value = false
      return world as Ref<GamePF2e>
    }
    return new Promise<Ref<GamePF2e>>((resolve) => {
      const timer = setTimeout(() => {
        worldActive.value = false
        resolve(world as Ref<GamePF2e>)
      }, WORLD_REQUEST_TIMEOUT_MS)

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

  // Lightweight status poll: hits /api/status every 8s (HTTP only, no socket
  // traffic). Immediately marks the world inactive when Foundry reports
  // active:false; triggers a full refresh when the world comes back up.
  setInterval(async () => {
    const running = await fetchWorldStatus()
    if (running === false && worldRunning.value !== false) {
      worldRunning.value = false
      worldActive.value = false
    } else if (running === true && worldRunning.value === false) {
      refreshWorld()
    }
  }, 8000)

  // Catch up on missed modifyDocument events that arrived while the page
  // was backgrounded by re-fetching the world on visibility return. The
  // 2s leading-edge debounce on refreshWorld absorbs spurious repeated
  // visibility events.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && world.value) refreshWorld()
  })

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
