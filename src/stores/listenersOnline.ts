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
// How long a presence probe waits for an answer before concluding that whoever
// didn't answer is gone. Only used on the paths where we have been TOLD the
// roster changed (see reportUserActivity), so this is a round trip's grace, not
// a heartbeat's — long enough for a slow link, far short of the TTL it stands in
// for.
const PRESENCE_PROBE_GRACE_MS = 3_000

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
// one. Nothing type-checks it, and forgetting used to be quiet: an ungated tap
// sat out the full REQUEST_ACK_TIMEOUT_MS and then reported nothing, which reads
// as a broken button rather than as an absent GM. There is now a backstop for
// that in api/actionRpc.ts — sendAction refuses before it sends, so a forgotten
// gate fails at once and says why. It is a backstop and not a substitute:
// rejecting a request the player should never have been offered is a worse
// experience than the affordance not being there, just a much shorter one.
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

  // ── Presence, told rather than polled ────────────────────────────────────
  //
  // The heartbeat above is a poll, and a poll is only ever as current as its
  // interval: a GM signing out left `isListening` true for the rest of the TTL
  // — up to 45 seconds of live roll buttons whose taps had nowhere to land.
  //
  // Foundry broadcasts the roster change itself. `userActivity` carries an
  // explicit `active` flag when a client joins or leaves (the same signal
  // targetHelper uses to notice a departed targeting proxy), and it arrives on
  // disconnect as well as on sign-out, so a GM who crashes or drops off the
  // network counts too.
  //
  // Hearing it, we do two things: drop the client that left, and ASK AGAIN.
  // Asking is what finds the other candidates — ANYBODY_HOME is answered only by
  // the client the world's GM-handler policy elects, so if a second GM has just
  // inherited the election, their answer repopulates this map within a round
  // trip. (The module pushes the same announcement from its `userConnected`
  // hook, so with a current module the answer usually arrives before the probe
  // does; the probe is what makes this work against an older one.)
  //
  // Anything that does NOT answer the probe is presumed gone, which is the point
  // of comparing against `askedAt` rather than pruning only the departed id: the
  // map can hold clients that no longer answer for requests, because every module
  // client announces once at `ready` while only the elected GM answers a ping. A
  // player who logged in half a minute ago used to keep `isListening` true
  // through a GM's departure for the remainder of their entry's TTL.
  //
  // The cost of being wrong here is one heartbeat: a client that was live but too
  // slow to answer within the grace window is re-added by its next announcement.
  let probeTimer: ReturnType<typeof setTimeout> | undefined

  function probeListeners() {
    const askedAt = Date.now()
    ping()
    clearTimeout(probeTimer)
    probeTimer = setTimeout(() => {
      listenersOnline.value.forEach((lastSeen, id, map) => {
        if (lastSeen < askedAt) map.delete(id)
      })
    }, PRESENCE_PROBE_GRACE_MS)
  }

  // `active` is absent on ordinary activity broadcasts (cursor, ruler, target
  // changes), so only an explicit boolean is a presence change.
  function reportUserActivity(id: string, active: boolean | undefined) {
    if (active === undefined) return
    if (!active) {
      // Logged at the same level as the arrival above: "the GM went away" is the
      // event a support log most often needs to place in time.
      if (listenersOnline.value.delete(id)) logger.debug('TM listener signed out', id)
      probeListeners()
      return
    }
    // A client joining tells us nothing by itself — it may be a player, and a
    // fresh login announces itself from the module's `ready` hook anyway. It is
    // worth a probe only while we believe nobody is home, where the answer can
    // only add: socket.io's soft reconnects don't re-run `ready`, so a GM whose
    // client dropped and came back never re-announces on its own.
    if (!isListening.value) probeListeners()
  }

  // Everything we know about who is listening belongs to one world. Called on a
  // server/user switch, where carrying it over means the new world inherits the
  // old world's GM — up to a full TTL of `isListening` describing a client that
  // cannot answer anything here.
  function reset() {
    listenersOnline.value = new Map()
    // A probe armed against the old world would prune a map that no longer
    // holds what it was asked about.
    clearTimeout(probeTimer)
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
    clearTimeout(probeTimer)
  })

  return {
    listenersOnline,
    isListening,
    addListener,
    reportUserActivity,
    ping,
    reset,
    start
  }
})
