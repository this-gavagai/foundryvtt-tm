import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPush } from './actionRpc'
import { useChatStore } from '@/stores/chat'
import { logger } from '@/utils/utilities'

// Push registration (milestone 2). On native launch the app obtains its device
// token; once it is also authenticated to a Foundry world, it asks the module
// (over TM.CHANNEL) for a signed reg token + the relay URL, then POSTs its token
// to the relay's /register. Sends thereafter address the user, so a rotated
// token is refreshed on the next launch instead of stranding the relay.

let deviceToken: string | null = null
let sessionAuthenticated = false
let lastRegisteredToken: string | null = null
let registering = false

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
    const messageId = (action.notification?.data as { tmMessageId?: string } | undefined)?.tmMessageId
    if (typeof messageId !== 'string' || !messageId) return
    try {
      useChatStore().requestFocusMessage(messageId)
    } catch (err) {
      logger.warn('[push] could not route notification tap:', err)
    }
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

// Registers only when we have both a device token and an authenticated session,
// and skips if the current token is already registered. Whichever of the two
// preconditions arrives second triggers the actual registration.
async function tryRegister(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (!deviceToken || !sessionAuthenticated || registering) return
  if (lastRegisteredToken === deviceToken) return

  registering = true
  const token = deviceToken
  try {
    // The module derives (worldId, userId) itself and signs them; the userId is
    // taken from the authenticated socket, so nothing identity-related is sent here.
    const { regToken, relayUrl } = await registerPush()
    const res = await fetch(`${relayUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regToken, deviceToken: token, platform: Capacitor.getPlatform() })
    })
    if (!res.ok) {
      logger.warn('[push] relay /register failed:', res.status, await res.text())
      return
    }
    lastRegisteredToken = token
    logger.info('[push] registered device with relay')
  } catch (err) {
    // No GM online, push not configured on the GM client, or offline — leave it
    // for the next session handshake to retry.
    logger.warn('[push] registration skipped:', err instanceof Error ? err.message : String(err))
  } finally {
    registering = false
  }
}
