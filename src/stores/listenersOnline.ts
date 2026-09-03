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

// ── What `isListening` is for, and the three answers it has ────────────────
//
// Some twenty components read this ref, which invites the thought that the
// decision should be centralized. It should not, and the reason is worth
// writing down once: the choice is per AFFORDANCE, not per operation. The same
// ADD_COMPENDIUM_ITEM request is answered two ways on purpose — the compendium
// modal falls back to a direct create for gear that needs no rules pipeline,
// while the condition picker cannot and greys out. A table keyed by RPC would
// have to be wrong about one of them.
//
// What IS shared is the vocabulary. Anything reaching the elected GM's client
// picks one of these, and no fourth:
//
//   FALL BACK   — the operation has a direct-write half that lands without a
//                 GM. Hit points (composables/setHitPoints), a compendium add
//                 of a rules-free physical item (CompendiumItemModal), the ammo
//                 selection on a loaded weapon (characterStrikes.changeAmmo).
//                 Always says less than the full path; say so where it shows.
//   HIDE        — the affordance is meaningless without the answer, and its
//                 absence reads as "not now" rather than as breakage. Roll
//                 chits, strike and spell buttons, inline @Check/@Damage
//                 anchors, the reload button, item send-to-chat.
//   DISABLE     — the affordance is the reason the surface exists, so removing
//                 it would leave a blank panel with no explanation. The
//                 condition picker, End Turn, the side menu's roll builders:
//                 all stay visible, greyed, with a line saying what is missing.
//
// The rule this file cannot enforce is that a new RPC-backed affordance chooses
// one. Nothing type-checks it, and the failure is quiet: an ungated tap sits out
// the full REQUEST_ACK_TIMEOUT_MS and then reports nothing, which reads as a
// broken button rather than an absent GM. If that keeps happening, the backstop
// to reach for is api/actionRpc.ts — one fast rejection in sendAction would make
// forgetting merely ugly instead of silent.
export const useListenersStore = defineStore('listenersOnline', () => {
  const listenersOnline = ref(new Map<string, number>())
  // Whether any module client is announcing itself. The app's whole GM-proxy
  // lane hangs off this, so it is deliberately generous about staleness — see
  // LISTENER_TTL_MS above.
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
