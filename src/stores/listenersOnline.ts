import { ref, computed, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { getAuthenticatedSocket } from '@/api/internal'
import { onForeground } from '@/utils/foreground'
import { logger } from '@/utils/utilities'
import { TM, PROTOCOL_VERSION } from '@/api/protocol'

// How often we announce ourselves and re-ask who is listening.
const HEARTBEAT_INTERVAL_MS = 30_000
// How long a listener stays "online" without re-announcing. Must comfortably
// exceed one heartbeat so a single dropped ping doesn't blink the GM offline
// (and with it every roll button in the app); one and a half is the margin.
const LISTENER_TTL_MS = 45_000

export const useListenersStore = defineStore('listenersOnline', () => {
  const listenersOnline = ref(new Map<string, number>())
  const isListening = computed(() => listenersOnline.value.size > 0)

  function addListener(listenerId: string) {
    logger.debug('TM adding listener', listenerId)
    listenersOnline.value.set(listenerId, Date.now())
  }

  function expireStaleListeners() {
    const now = Date.now()
    listenersOnline.value.forEach((lastSeen, id, map) => {
      if (now - lastSeen > LISTENER_TTL_MS) map.delete(id)
    })
  }

  // Announce ourselves and ask who is out there.
  //
  // Expiry runs FIRST, and unconditionally: getAuthenticatedSocket waits out a
  // 15s session timeout before rejecting when there is no connection, so a prune
  // sequenced after the emit simply never runs while the app is offline. That
  // left `isListening` pinned true for the whole outage — roll buttons live, and
  // every tap sitting out its full 30s ack timeout with nothing to answer it.
  async function pingHeartbeat() {
    expireStaleListeners()
    const { socket, userId } = await getAuthenticatedSocket()
    socket.emit(TM.CHANNEL, {
      userId,
      action: TM.ANYBODY_HOME,
      // Piggyback the version handshake on the existing presence ping so the
      // Foundry side can flag an incompatible client (no extra round-trip).
      protocol: PROTOCOL_VERSION,
      appVersion: __APP_VERSION__
    })
  }

  // The one entry point for "re-announce now": callers never want the rejection
  // (there is nothing to do about it, and the next tick retries anyway).
  function ping() {
    void pingHeartbeat().catch(() => undefined)
  }

  // Everything we know about who is listening belongs to one world. Called on a
  // server/user switch, where carrying it over means the new world inherits the
  // old world's GM — up to a full TTL of `isListening` describing a client that
  // cannot answer anything here.
  function reset() {
    listenersOnline.value = new Map()
  }

  // Start the presence machinery: a heartbeat, an immediate ping, and a
  // foreground re-ping. Kept out of the store setup body (idempotent) so
  // instantiating the store in a test doesn't emit a socket ping or spawn an
  // interval; the app calls start() once at bootstrap. Disposal below clears
  // whatever start() created. The re-ping on each session handshake is driven
  // from serverEventWiring, with the rest of the handshake fan-out.
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined
  let stopForeground: (() => void) | undefined
  let started = false
  function start(): void {
    if (started) return
    started = true
    heartbeatInterval = setInterval(ping, HEARTBEAT_INTERVAL_MS)
    ping()
    // Mobile browsers throttle or pause setInterval in the background, so the
    // heartbeat lapses and every listener ages out — leaving isListening stuck
    // false (and roll buttons hidden) until the next tick.
    stopForeground = onForeground(ping)
  }

  onScopeDispose(() => {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    stopForeground?.()
  })

  return { listenersOnline, isListening, addListener, ping, reset, start }
})
