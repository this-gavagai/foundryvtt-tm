import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPush } from './actionRpc'
import { recordPushRegistration } from './pushRegistry'
import { useChatStore } from '@/stores/chat'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useUserStore } from '@/stores/user'
import { logger } from '@/utils/utilities'

// Push registration (milestone 2). On native launch the app obtains its device
// token; once it is also authenticated to a Foundry world, it asks the module
// (over TM.CHANNEL) for a signed reg token + the relay URL, then POSTs its token
// to the relay's /register. Sends thereafter address the user, so a rotated
// token is refreshed on the next launch instead of stranding the relay.

let deviceToken: string | null = null
let sessionAuthenticated = false
let lastRegisteredIdentity: string | null = null
let lastRegisteredAt = 0
let registering = false

// The relay prunes any registration untouched for 30 days, and re-registration
// otherwise only happens when the identity changes — which, on a device iOS keeps
// alive, might be never. Re-register on foreground so liveness stops depending on
// the app being killed. This also resets the relay's badge counter (a /register
// clears it), pairing with the icon the app clears locally on becoming active.
//
// Throttled, because the free plan's ~1,000 KV writes a DAY — account-wide,
// shared with every world's registrations — is this relay's real ceiling. The
// throttle is now the smaller half of that defence: the relay answers a
// re-registration that says nothing new without writing at all (see
// handleRegister), so the routine foreground costs reads. What the interval buys
// is fewer round-trips, not fewer writes.
//
// Which is why it stays in minutes rather than hours. The badge count only
// resets when the app checks in, so a long interval would let the icon
// over-report whispers the user has already read — and now that the badge counts
// only direct messages, over-reporting those is exactly the wrong error.
const HEARTBEAT_MIN_INTERVAL_MS = 15 * 60 * 1000

// What a registration is actually *for*: this device, at this server, as this
// user. Registrations are per (world, user) relay-side, so the device token
// alone is not enough to tell "already registered" from "needs registering" —
// keying the skip on the token alone meant switching servers (or re-logging as
// someone else) silently never registered, since the token never changes.
// Returns null while any part is unknown.
function currentIdentity(): string | null {
  if (!deviceToken || !sessionAuthenticated) return null
  const origin = useServerAddressStore().serverUrl?.origin
  const userId = useUserStore().getUserId()
  if (!origin || !userId) return null
  return `${origin}|${userId}|${deviceToken}`
}

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

// A notification belongs to one world, reached at one address. Since the app can
// be pointed at a different server by the time the user taps, switch to the one
// the push came from before handing its message id to the chat store — an id from
// another world would otherwise scroll to nothing (or, worse, to a coincidence).
//
// Returns false when the message cannot be shown: the push names a server this
// device no longer has saved. Tapping then just opens the app, which is the
// honest outcome — better than focusing a foreign id in whatever world is open.
// A payload with no server (an older relay) is trusted as-is, preserving the
// previous single-server behaviour.
function pointAtNotificationServer(serverBaseUrl: string | undefined): boolean {
  const wanted = originOf(serverBaseUrl)
  if (!wanted) return true

  const store = useServerAddressStore()
  if (originOf(store.serverUrl?.origin) === wanted) return true
  if (!store.servers.some((saved) => originOf(saved) === wanted)) {
    logger.warn('[push] notification is for an unknown server, not switching:', wanted)
    return false
  }
  logger.info('[push] notification tap switching server to', wanted)
  store.selectServer(wanted)
  return true
}

// Called once from the native bootstrap (main.ts). Wires the token listeners,
// requests permission, and kicks off APNs/FCM registration.
export async function initPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  await PushNotifications.addListener('registration', (token) => {
    deviceToken = token.value
    logger.info('[push] device token:', token.value)
    void tryRegister()
  })
  await PushNotifications.addListener('registrationError', (err) => {
    logger.warn('[push] registration error:', JSON.stringify(err))
  })

  // Tapping a notification deep-links to the message. The relay stamps the
  // ChatMessage id as `tmMessageId` in the payload; hand it to the chat store,
  // which the chat overlay watches (opens + scrolls to + highlights it). Works
  // on cold start too — the overlay's watcher is `immediate`, so an intent set
  // before it mounts is picked up once it does.
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = action.notification?.data as
      | { tmMessageId?: string; tmServerBaseUrl?: string }
      | undefined
    const messageId = data?.tmMessageId
    if (typeof messageId !== 'string' || !messageId) return
    try {
      if (!pointAtNotificationServer(data?.tmServerBaseUrl)) return
      useChatStore().requestFocusMessage(messageId)
    } catch (err) {
      logger.warn('[push] could not route notification tap:', err)
    }
  })

  // Foreground heartbeat. `visibilitychange` rather than a native app-state
  // listener: the WebView fires it when iOS backgrounds/foregrounds the app, so
  // this needs no extra Capacitor plugin, and a platform that fires it less
  // reliably simply falls back to the previous cold-launch-only behaviour.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void heartbeat()
  })

  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') {
    logger.warn('[push] permission not granted:', perm.receive)
    return
  }
  await PushNotifications.register()
}

// Called from serverEventWiring's onSessionAuthenticated hook — i.e. whenever we
// are connected and authenticated to a world as a known user. Idempotent.
export function syncPushRegistration(): void {
  sessionAuthenticated = true
  void tryRegister()
}

// Called when the session's user changes (server switch, or re-login as someone
// else), before the new user id is committed. Nothing may be registered against
// the identity we are leaving, and the next onSessionAuthenticated re-arms this.
export function resetPushSession(): void {
  sessionAuthenticated = false
  lastRegisteredIdentity = null
}

// Re-register even though nothing about the identity changed, to refresh the
// relay's liveness timestamp and reset its badge counter. Also the mechanism that
// picks up a world whose push identity was re-minted underneath us (a duplicated
// world — see ensureWorldPushIdentity), since that changes neither the origin nor
// the user id this device registered as.
async function heartbeat(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (Date.now() - lastRegisteredAt < HEARTBEAT_MIN_INTERVAL_MS) return
  lastRegisteredIdentity = null
  await tryRegister()
}

// Registers only when we have both a device token and an authenticated session,
// and skips if this exact (server, user, token) is already registered. Whichever
// of the preconditions arrives second triggers the actual registration; a later
// server switch or re-login changes the identity and so registers again.
async function tryRegister(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (!deviceToken || !sessionAuthenticated || registering) return
  const identity = currentIdentity()
  if (!identity || identity === lastRegisteredIdentity) return

  registering = true
  const token = deviceToken
  // The origin this device reaches the world at. The relay stitches portrait
  // paths onto it so notification images resolve to an address the phone can
  // actually fetch (the GM host's own localhost/LAN origin cannot). Read once,
  // up front, so everything below is consistent with the identity we checked.
  const serverBaseUrl = useServerAddressStore().serverUrl?.origin
  try {
    // The module derives (worldId, userId) itself and signs them; the userId is
    // taken from the authenticated socket, so nothing identity-related is sent here.
    const { regToken, relayUrl } = await registerPush()
    const res = await fetch(`${relayUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regToken, deviceToken: token, platform: Capacitor.getPlatform(), serverBaseUrl })
    })
    if (!res.ok) {
      logger.warn('[push] relay /register failed:', res.status, await res.text())
      return
    }
    lastRegisteredIdentity = identity
    lastRegisteredAt = Date.now()
    // The relay echoes the (world, user) it filed us under — neither of which we
    // can derive locally. Persist it against this origin so forgetting the
    // server can undo the registration later, offline. See pushRegistry.
    const filed = (await res.json().catch(() => null)) as { worldId?: string; userId?: string } | null
    if (serverBaseUrl && filed?.worldId && filed.userId) {
      recordPushRegistration(serverBaseUrl, {
        relayUrl,
        worldId: filed.worldId,
        userId: filed.userId,
        deviceToken: token
      })
    }
    logger.info('[push] registered device with relay')
  } catch (err) {
    // No GM online, push not configured on the GM client, or offline — leave it
    // for the next session handshake to retry.
    logger.warn('[push] registration skipped:', err instanceof Error ? err.message : String(err))
  } finally {
    registering = false
    // A switch that landed mid-flight was dropped by the `registering` guard;
    // pick it up now. Bounded: it only re-runs when the identity genuinely moved
    // (user action), not on a failed registration for the same identity.
    if (currentIdentity() !== identity) void tryRegister()
  }
}
