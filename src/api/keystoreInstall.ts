import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

import { logger } from '@/utils/utilities'

// iOS keychain items outlive the app that wrote them: deleting the app tears
// down its container — localStorage, cookies, the cached sheets on disk — but
// leaves every keychain entry in place for the next install to find. So a
// reinstalled app that looks brand new still holds the last user's password,
// and silent re-auth signs them straight back in the moment the server address
// is typed. From the outside that is the app remembering someone who was meant
// to be forgotten.
//
// The keychain is a cache subordinate to the app, never an authority that
// outlives it. This marker states that: a file in the app container, which the
// OS deletes with the app, so its absence means the keystore's contents belong
// to an install that no longer exists.
//
// It lives in the container rather than in localStorage because localStorage is
// WebView website data, and so are the session cookies that credentialStore
// exists to outlive — one eviction takes both. A marker in there would arm the
// purge on exactly the event the saved password is meant to survive. The
// container is the outer layer: it goes when the install goes, and not before.
//
// Directory.Library is the app's private support storage on both platforms
// (Library/ on iOS, filesDir on Android) — not Cache, which iOS reclaims under
// disk pressure, and not LibraryNoCloud, which Android does not map at all.
//
// Android's KeyStore already goes with the app data, so nothing here has work
// to do on that platform; it runs anyway, because the invariant is the same and
// a second implementation of it would be one more thing to keep in step.

const MARKER_PATH = 'tm-keystore-install'

// Storage this app wrote before the marker existed. A container holding it is
// an install that has been running all along, so the keystore is its own.
const CONTAINER_IN_USE_KEYS = ['tablemate.serverUrl', 'tablemate.servers']

// Positive evidence either way, never an inference from a failed read: a purge
// is destructive, so "the marker is missing" has to be something the filesystem
// actually said. A directory listing says it for any reason a file can be
// absent; a stat that throws cannot tell "no such file" from "no filesystem".
async function markerPresent(): Promise<boolean> {
  const { files } = await Filesystem.readdir({ directory: Directory.Library, path: '' })
  return files.some((f) => f.name === MARKER_PATH)
}

async function claimKeystore(): Promise<void> {
  await Filesystem.writeFile({
    directory: Directory.Library,
    path: MARKER_PATH,
    data: new Date().toISOString(),
    encoding: Encoding.UTF8
  })
}

async function purgeOrphanedKeystore(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (await markerPresent()) return
  if (CONTAINER_IN_USE_KEYS.some((k) => localStorage.getItem(k))) {
    await claimKeystore()
    return
  }
  // clear() removes every item under the plugin's key prefix, which is all this
  // app writes there: the saved passwords and the transcription key. Both are
  // re-enterable, so the cost of a purge is a login page, never lost data.
  await SecureStorage.clear()
  // Claimed only after a clean sweep, so a keystore that refused to clear is
  // swept on the next launch instead of being declared this install's. The
  // exposure that buys — a marker write that keeps failing re-purges each
  // launch, costing the password of a device whose storage is already full —
  // is the lesser one: it ends at a login page, whereas the alternative leaves
  // the previous user signed in on someone else's phone indefinitely.
  await claimKeystore()
}

const ready = purgeOrphanedKeystore().catch((e: unknown) => {
  logger.debug('TM-DIAG keystoreInstall: purge failed', String(e))
})

// Awaited by every keystore entry point, reads and writes alike: a write that
// raced the purge would be swept away with the previous install's entries.
// Resolved once and shared, so the check runs a single time per launch.
export function keystoreReady(): Promise<void> {
  return ready
}
