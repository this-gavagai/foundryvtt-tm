import { ref, computed, watch, onScopeDispose } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { getAuthenticatedSocket } from '@/api/internal'
import { useServerStore } from '@/stores/server'
import { logger } from '@/utils/utilities'
import { TM, PROTOCOL_VERSION } from '@/api/protocol'

export const useListenersStore = defineStore('listenersOnline', () => {
  const listenersOnline = ref(new Map<string, number>())
  const isListening = computed(() => listenersOnline.value.size > 0)

  function addListener(listenerId: string) {
    logger.debug('TM adding listener', listenerId)
    listenersOnline.value.set(listenerId, Date.now())
  }

  function getListeners() {
    return listenersOnline
  }

  async function pingHeartbeat() {
    const { socket, userId } = await getAuthenticatedSocket()
    socket.emit(TM.CHANNEL, {
      userId,
      action: TM.ANYBODY_HOME,
      // Piggyback the version handshake on the existing presence ping so the
      // Foundry side can flag an incompatible client (no extra round-trip).
      protocol: PROTOCOL_VERSION,
      appVersion: __APP_VERSION__
    })
    listenersOnline.value.forEach((value, key, map) => {
      if (Date.now() - value > 45000) map.delete(key)
    })
  }

  function safePingHeartbeat() {
    void pingHeartbeat().catch(() => undefined)
  }

  // Mobile browsers throttle or pause setInterval when the tab is in the
  // background, so the heartbeat can lapse — leaving isListening stuck on
  // false (and roll buttons hidden) until the next tick. Re-ping immediately
  // when the page comes back into focus.
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') safePingHeartbeat()
  }

  const { sessionReady } = storeToRefs(useServerStore())

  // Start the presence machinery: a 30s heartbeat, an immediate ping, a
  // visibility re-ping, and a re-ping on every session handshake. Kept out of
  // the store setup body (idempotent) so instantiating the store in a test
  // doesn't emit a socket ping or spawn a 30s interval; the app calls start()
  // once at bootstrap. Disposal below clears whatever start() created.
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined
  let stopSessionWatch: (() => void) | undefined
  let started = false
  function start(): void {
    if (started) return
    started = true
    heartbeatInterval = setInterval(safePingHeartbeat, 30000)
    safePingHeartbeat()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    // Re-ping on every fresh session handshake. The visibility ping races the
    // connection-recovery probe (it can fire ANYBODY_HOME on the stale socket
    // that recovery is about to replace, then prune the expired listeners),
    // and a recovery-triggered reconnect refreshes world/character data but
    // never re-announces GM presence — leaving the PWA "connected to the world
    // but without a GM" until the next 30s tick. Keying off sessionReady
    // guarantees a heartbeat on the new socket the moment auth completes,
    // covering every reconnect path (probe, online, soft reconnect, re-auth).
    stopSessionWatch = watch(sessionReady, (ready) => {
      if (ready) safePingHeartbeat()
    })
  }

  onScopeDispose(() => {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    stopSessionWatch?.()
  })

  return { listenersOnline, isListening, addListener, getListeners, start }
})
