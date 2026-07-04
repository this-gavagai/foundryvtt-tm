import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { useServerStore } from '@/stores/server'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { markWorldRequestSent } from '@/api/loadPriority'

const REFRESH_DEBOUNCE_MS = 2000

export const useWorldStore = defineStore('world', () => {
  const world = shallowRef<GamePF2e | undefined>(undefined)

  // Counts in-place mutations to world.messages (creates/updates/deletes
  // arriving via modifyDocument — bumped by the socket handler). The chat
  // persistence watcher folds this into its change fingerprint: an *update* to
  // an older message (e.g. damage applied rewriting its content) changes
  // neither the message count nor the tail identity, so without this signal
  // the cached tail would silently keep the pre-edit copy.
  const messagesRevision = ref(0)
  function bumpMessagesRevision(): void {
    messagesRevision.value++
  }

  async function sendWorldRequest(): Promise<void> {
    // Check /api/status first — works regardless of auth state.
    const worldStatus = useFoundryWorldStatusStore()
    const running = await worldStatus.fetchWorldStatus()
    if (running === false) {
      worldStatus.markWorldInactive()
      // No world request will go out — release the sheets gated behind it so
      // they don't sit out the full loadPriority fallback timeout.
      markWorldRequestSent()
      return
    }
    if (running === true) worldStatus.markWorldLoaded()

    // World is running (or status check failed) — try to get world data via socket.
    // Don't downgrade worldAuthenticated on transient socket failures — the
    // last-known state stays visible until a healthy round-trip arrives.
    const socket = await useServerStore()
      .getSocket()
      .catch(() => null)
    if (!socket) {
      markWorldRequestSent()
      return
    }

    socket.emit('world', (r: GamePF2e) => {
      // A valid world response always includes a userId. An empty object or
      // a response without userId means the world is not active.
      worldStatus.setWorldAuthenticated(!!r?.userId)
      if (r?.userId) world.value = r
    })
    // The world request is now out — release any non-active character sheets
    // gated behind it so they slot in after the world (see loadPriority).
    markWorldRequestSent()
  }

  // Fire an immediate world refresh so worldLoaded gets a definite value
  // (via /api/status, which doesn't need auth) before the spinner has a
  // chance to camp on `undefined`. Without this, a PWA cold-launch where
  // the socket connects but the `session` event is slow leaves the app
  // stuck on the spinner.
  const refreshWorld = debounce(sendWorldRequest, REFRESH_DEBOUNCE_MS, {
    leading: true,
    trailing: false
  })
  const refreshWorldNow = sendWorldRequest
  refreshWorld()

  // Drop the last-known world so stale actors/ownership from a previous
  // session can't be checked against a new user. Called on a genuine
  // identity change (server/user switch), not on same-user reconnects —
  // those intentionally keep the stale world visible until fresh data lands.
  function clearWorld(): void {
    world.value = undefined
  }

  return { world, messagesRevision, bumpMessagesRevision, refreshWorld, refreshWorldNow, clearWorld }
})
