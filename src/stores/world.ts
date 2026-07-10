import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { debounce } from 'lodash-es'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { useServerStore } from '@/stores/server'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { markWorldRequestSent } from '@/api/loadPriority'
import { emitWithTimeout } from '@/api/socketConnection'

const REFRESH_DEBOUNCE_MS = 2000
// World payloads can be large and the GM serializes them behind actor
// requests, so give the ack a generous budget before giving up. A timed-out
// request is simply dropped — the next refresh trigger (session handshake,
// world-progress trailing edge, visibility resume) retries.
const WORLD_REQUEST_TIMEOUT_MS = 15_000

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

    const request = emitWithTimeout<GamePF2e>(socket, 'world', WORLD_REQUEST_TIMEOUT_MS)
    // The world request is now out — release any non-active character sheets
    // gated behind it so they slot in after the world (see loadPriority).
    markWorldRequestSent()

    try {
      const r = await request
      // A valid world response always includes a userId. An empty object or
      // a response without userId means the world is not active.
      worldStatus.setWorldAuthenticated(!!r?.userId)
      if (r?.userId) world.value = r
    } catch {
      // No ack before the timeout. Don't downgrade worldAuthenticated — the
      // last-known state stays visible until a healthy round-trip arrives
      // (same policy as the socket-acquisition failure above).
    }
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

  return {
    world,
    messagesRevision,
    bumpMessagesRevision,
    refreshWorld,
    refreshWorldNow,
    clearWorld
  }
})
