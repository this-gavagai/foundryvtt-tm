import { Capacitor } from '@capacitor/core'
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage'

import { logger } from '@/utils/utilities'

// Per-server login credentials, held in the OS keystore (iOS Keychain /
// Android KeyStore) so the app can re-authenticate itself when Foundry's
// session cookie dies — a Foundry restart, an expired session, a cookie lost
// to a webview eviction. Without this the only way to mint a new session is a
// human typing a password, which is what made every transient auth hiccup a
// trip to the login page.
//
// Native only, deliberately. The browser build is served by the Foundry host
// itself, where the session cookie already works and the only storage
// available is readable by any script that gets injected into the page.

const KEY_PREFIX = 'tm.credential.'

// The plugin falls back to plain localStorage off-device. Rather than rely on
// callers to remember that, every entry point below is inert unless we're on a
// real keystore — so a password can never be written somewhere unprotected.
const hasKeystore = Capacitor.isNativePlatform()

// afterFirstUnlock (not whenUnlocked) so a re-auth can run while the screen is
// locked — the app is woken by chat push notifications. ThisDeviceOnly keeps
// the password out of iCloud Keychain and encrypted device backups: it's
// recoverable by re-entering it, so there's no reason to let it travel.
const KEYCHAIN_ACCESS = KeychainAccess.afterFirstUnlockThisDeviceOnly

export interface StoredCredential {
  userid: string
  password: string
}

function credentialKey(origin: string): string {
  return `${KEY_PREFIX}${origin}`
}

function isCredential(value: unknown): value is StoredCredential {
  const c = value as StoredCredential | null
  return typeof c?.userid === 'string' && typeof c?.password === 'string'
}

// The credential saved for a server, or undefined if there is none.
//
// A keystore read failure also resolves to undefined: the caller's fallback is
// the login page, which is the only recovery available either way. It must not
// be mistaken for "the password is wrong" — nothing is ever deleted from here
// on a read error.
export async function readCredential(origin: string): Promise<StoredCredential | undefined> {
  if (!origin || !hasKeystore) return undefined
  try {
    const stored = await SecureStorage.get(credentialKey(origin))
    if (!isCredential(stored)) return undefined
    return stored
  } catch (e) {
    logger.debug('TM-DIAG credentialStore: read failed', String(e))
    return undefined
  }
}

// Best effort: a keystore that won't accept the write costs the user the
// silent-relogin convenience, not the login they just completed.
export async function writeCredential(
  origin: string,
  userid: string,
  password: string
): Promise<void> {
  if (!origin || !userid || !hasKeystore) return
  try {
    await SecureStorage.set(
      credentialKey(origin),
      { userid, password },
      // convertDate/sync defaults; `access` is the one we actually care about.
      true,
      false,
      KEYCHAIN_ACCESS
    )
  } catch (e) {
    logger.debug('TM-DIAG credentialStore: write failed', String(e))
  }
}

export async function forgetCredential(origin: string): Promise<void> {
  if (!origin || !hasKeystore) return
  try {
    await SecureStorage.remove(credentialKey(origin))
  } catch (e) {
    logger.debug('TM-DIAG credentialStore: remove failed', String(e))
  }
}
