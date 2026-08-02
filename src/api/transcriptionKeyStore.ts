import { Capacitor } from '@capacitor/core'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'

import { logger } from '@/utils/utilities'

// This device's transcription API key — a billable credential, so on native it
// goes to the OS keystore (iOS Keychain / Android KeyStore) rather than sitting
// beside the rest of the app's preferences in localStorage. The endpoint and
// model are not secret and live in the settings store like any other setting.
//
// Off-device (the browser build, served by the Foundry host itself) the plugin
// falls back to plain localStorage, so we use localStorage directly and say so:
// that is the same exposure the old Foundry client-scoped setting had, since
// Foundry keeps client settings in localStorage too.
//
// Reads are async either way, so the settings store hydrates the key once at
// startup (see stores/settings.ts) instead of reading it per memo.

const STORAGE_KEY = 'tm.transcription.apiKey'

const hasKeystore = Capacitor.isNativePlatform()

// afterFirstUnlock, matching credentialStore: transcription can run while the
// screen is locked (the app is woken by chat push notifications). ThisDeviceOnly
// keeps the key out of iCloud Keychain and encrypted device backups — it is
// re-pastable, so there is no reason to let it travel.
const KEYCHAIN_ACCESS = KeychainAccess.afterFirstUnlockThisDeviceOnly

// The key stored on this device, or '' when there is none. A read failure also
// reads as '' — transcription is simply off until the user re-enters it, which
// is the same recovery either way; nothing is ever deleted on a read error.
export async function readTranscriptionKey(): Promise<string> {
  try {
    if (!hasKeystore) return localStorage.getItem(STORAGE_KEY) ?? ''
    const stored = await SecureStorage.get(STORAGE_KEY)
    return typeof stored === 'string' ? stored : ''
  } catch (e) {
    logger.debug('TM-DIAG transcriptionKeyStore: read failed', String(e))
    return ''
  }
}

// Save (or, for an empty value, clear) the key. Best effort: a keystore that
// won't accept the write costs the user transcription on the next launch, not
// the memo they are recording now — the in-memory setting is already live.
export async function writeTranscriptionKey(apiKey: string): Promise<void> {
  const value = apiKey.trim()
  try {
    if (!value) {
      if (hasKeystore) await SecureStorage.remove(STORAGE_KEY)
      else localStorage.removeItem(STORAGE_KEY)
      return
    }
    if (hasKeystore) await SecureStorage.set(STORAGE_KEY, value, true, false, KEYCHAIN_ACCESS)
    else localStorage.setItem(STORAGE_KEY, value)
  } catch (e) {
    logger.debug('TM-DIAG transcriptionKeyStore: write failed', String(e))
  }
}
