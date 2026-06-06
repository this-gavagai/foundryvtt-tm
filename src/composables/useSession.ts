import { ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { Socket } from 'socket.io-client'

import { setupSocketListenersForApp, setupSocketListenersForWorld } from '@/api/socketSetup'
import { TM } from '@/api/protocol'
import { useServerStore } from '@/stores/server'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'

// Owns the server-connection and world/session lifecycle: opens the socket and
// keeps it warm, (re-)registers socket listeners whenever the socket is
// replaced, and re-requests the world whenever a session is (re-)established.
//
// Returns `reconnecting`, which is true while a world-triggered reconnect is in
// flight so the view can show a spinner instead of the login page.
export function useSession(): { reconnecting: Ref<boolean> } {
  const BUILD_MODE = import.meta.env.MODE
  const location = new URL(window.location.origin)

  const serverStore = useServerStore()
  const { needsLogin, socket } = storeToRefs(serverStore)
  const { connectToServer } = serverStore
  const userStore = useUserStore()
  const { userId } = storeToRefs(userStore)
  const { getUserId } = userStore
  const worldStore = useWorldStore()
  const { worldRunning } = storeToRefs(worldStore)
  const { refreshWorld } = worldStore

  // connect to server and ping it periodically
  connectToServer(location).then((socket: Ref<Socket | undefined>) => {
    setTimeout(
      () => socket.value?.emit(TM.CHANNEL, { action: TM.ANYBODY_HOME, userId: getUserId() }),
      100
    )
    if (BUILD_MODE !== 'development') {
      setInterval(() => {
        socket.value?.emit(TM.CHANNEL, { action: TM.ANYBODY_HOME, userId: getUserId() })
      }, 50000)
    }
  })

  // Re-register socket listeners whenever a new socket is created (e.g. after
  // connectToServer replaces the socket on auth failure or re-login).
  // setupSocketListenersForApp/World are idempotent: they remove stale handlers
  // before re-adding, so calling them multiple times is safe.
  let worldListenersReady = false
  watch(socket, (newSocket) => {
    if (!newSocket) return
    setupSocketListenersForApp()
    if (worldListenersReady) refreshWorld().then((w) => setupSocketListenersForWorld(w))
  })

  // When the world starts while the socket is unauthenticated, Foundry won't
  // re-send the session event on the existing socket — reconnecting causes a
  // fresh handshake so Foundry can authenticate the browser's session cookie.
  // reconnecting stays true while connectToServer is in-flight so the spinner
  // is shown instead of LoginPage, preventing loadUsers from running against
  // the old pre-world socket before the new one is ready.
  const reconnecting = ref(false)
  watch(worldRunning, async (isRunning) => {
    if (isRunning && needsLogin.value) {
      reconnecting.value = true
      await connectToServer(location)
      reconnecting.value = false
    }
  })

  // Keep watching userId so refreshWorld() fires whenever a session is
  // established or re-established (e.g. world reloads after being inactive).
  watch(
    userId,
    (newId) => {
      if (!newId) return
      if (!worldListenersReady) {
        worldListenersReady = true
        refreshWorld().then((w) => setupSocketListenersForWorld(w))
      } else {
        refreshWorld()
      }
    },
    { immediate: true }
  )

  // After a successful login the socket reconnects and needsLogin drops to false.
  // Re-request the world immediately rather than waiting for the next heartbeat.
  watch(needsLogin, (val) => {
    if (!val) refreshWorld()
  })

  return { reconnecting }
}
