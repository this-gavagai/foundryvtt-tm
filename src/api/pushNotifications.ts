import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

// Milestone 1 (test push): request permission, register with APNs/FCM, and log
// the device token so it can be copied into a manual `curl` against the relay.
//
// This is deliberately minimal — it only obtains and logs the token. Binding the
// token to a Foundry user and POSTing it to the relay's /register endpoint is
// milestone 2; taps/deep-linking come later. Safe to call unconditionally: it
// no-ops off native platforms.
export async function initPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  // The token arrives asynchronously via the 'registration' event, so wire the
  // listeners before calling register().
  await PushNotifications.addListener('registration', (token) => {
    // Grep for this line in the Xcode / Android Studio console to copy the token.
    console.log('[push] device token:', token.value)
  })

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('[push] registration error:', JSON.stringify(err))
  })

  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') {
    console.warn('[push] permission not granted:', perm.receive)
    return
  }

  // Triggers APNs (iOS) / FCM (Android) registration; the token comes back on
  // the 'registration' listener above.
  await PushNotifications.register()
}
