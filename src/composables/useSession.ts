import { ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'

import { setupSocketListenersForApp, setupSocketListenersForWorld } from '@/api/socketSetup'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useServerStore } from '@/stores/server'
import { useWorldStore } from '@/stores/world'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// Owns the server-connection and world/session lifecycle: opens the socket and
// (re-)registers socket listeners whenever the socket is replaced, and attaches
// world listeners once an authenticated world is loaded.
//
// Returns `reconnecting`, which is true while a world-triggered reconnect is in
// flight so the view can show a spinner instead of the login page.
export function useSession(): { reconnecting: Ref<boolean> } {
  const { serverUrl } = storeToRefs(useServerAddressStore())
  const serverStore = useServerStore()
  const { needsLogin, socket } = storeToRefs(serverStore)
  const { connectToServer } = serverStore
  const userStore = useUserStore()
  const { userId } = storeToRefs(userStore)
  const worldStore = useWorldStore()
  const { world } = storeToRefs(worldStore)
  const { worldLoaded } = storeToRefs(useFoundryWorldStatusStore())

  // Connect to the server. The socket watcher owns follow-up setup so every
  // successful connection path, including login and reconnect, behaves the same.
  watch(
    serverUrl,
    (location) => {
      if (!location) return
      void connectToServer(location).catch(() => {})
    },
    { immediate: true }
  )

  // Re-register socket listeners whenever a new socket is created (e.g. after
  // connectToServer replaces the socket on auth failure or re-login).
  // setupSocketListenersForApp/World are idempotent: they remove stale handlers
  // before re-adding, so calling them multiple times is safe.
  let worldListenersReady = false

  async function setupAppSocketListeners() {
    try {
      await setupSocketListenersForApp()
    } catch (e) {
      logger.debug('Error setting up app socket listeners: ', e)
    }
  }

  async function setupWorldSocketListeners() {
    if (!world.value) return
    try {
      await setupSocketListenersForWorld(world)
    } catch (e) {
      logger.debug('Error setting up world socket listeners: ', e)
    }
  }

  watch(
    socket,
    (newSocket) => {
      if (!newSocket) return
      void setupAppSocketListeners()
      if (worldListenersReady) void setupWorldSocketListeners()
    },
    { immediate: true }
  )

  // When the world starts while the socket is unauthenticated, Foundry won't
  // re-send the session event on the existing socket; reconnecting causes a
  // fresh handshake so Foundry can authenticate the browser's session cookie.
  // reconnecting stays true while connectToServer is in-flight so the spinner
  // is shown instead of LoginPage, preventing loadUsers from running against
  // the old pre-world socket before the new one is ready.
  const reconnecting = ref(false)
  let reconnectId = 0
  watch(worldLoaded, async (isRunning) => {
    const location = serverUrl.value
    if (isRunning && needsLogin.value && location) {
      const currentReconnectId = ++reconnectId
      reconnecting.value = true
      try {
        await connectToServer(location)
      } catch {
        // Keep needsLogin visible; the login page can retry against the live world.
      } finally {
        if (currentReconnectId === reconnectId) reconnecting.value = false
      }
    }
  })

  // The server store refreshes world data on every session handshake. This
  // watcher only attaches world-scoped socket listeners once that refresh has
  // produced a world, then re-attaches them to future replacement sockets.
  watch(
    [userId, world],
    ([newId, newWorld]) => {
      if (!newId || !newWorld) return
      if (!worldListenersReady) {
        worldListenersReady = true
      }
      void setupWorldSocketListeners()
    },
    { immediate: true }
  )

  return { reconnecting }
}
