import { reactive } from 'vue'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem, type FileInfo } from '@capacitor/filesystem'
import { waitForPriorRequests } from '@/api/loadPriority'

// Persistent on-disk cache for remote Foundry image assets in the native app.
//
// The browser PWA gets a Workbox CacheFirst bucket for images (see
// vite.config.mts), but that service worker is disabled in the Capacitor build
// and wouldn't run under the capacitor:// scheme anyway. Native <img> loads go
// straight through the webview's own network stack — which doesn't reliably
// cache (Foundry sends weak Cache-Control headers, and WKWebView evicts
// aggressively), so the same icons re-download on every launch.
//
// This module mirrors the Workbox behaviour for native: getPath() asks for a
// cached src; on a miss it returns the remote URL (so nothing blanks — at the
// cost of the first view fetching twice, once by the <img> and once for the
// cache) and queues a background download into Directory.Cache. The lookup map
// is reactive, so once a file lands every template <img :src="getPath(...)">
// re-renders and swaps from the remote URL to a local file:// URI. Subsequent
// launches repopulate the map from the cache directory and serve from disk.
// Expiry mirrors the Workbox bucket: entries older than MAX_AGE_MS are dropped
// and the directory is capped at MAX_ENTRIES.

const CACHE_DIR = 'tablemate-image-cache'
const MAX_ENTRIES = 300
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days, same as the Workbox bucket
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
// A cold start renders every icon on the sheet at once; an uncapped fan-out of
// downloads + file writes would compete with the actor/world handshake for the
// same cold-start window (the contention loadPriority exists to prevent).
const MAX_CONCURRENT_DOWNLOADS = 4

// remote absolute URL -> webview-loadable local src (convertFileSrc of the
// cached file). reactive so a render that read a miss re-runs on the hit.
const localByRemote = reactive(new Map<string, string>())
// URLs queued or downloading, so repeated renders don't pile up duplicate
// fetches. Failed downloads back off for a while before retrying.
const scheduled = new Set<string>()
const failedAt = new Map<string, number>()
const downloadQueue: string[] = []
let activeDownloads = 0
// Misses seen before the startup index finishes; flushed once it lands so an
// image rendered exactly once during init still gets cached.
const pendingBeforeInit = new Set<string>()
let indexReady = false

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

// Filenames are the base64url-encoded remote URL plus the original extension,
// so the in-memory map can be rebuilt from a directory listing alone — no
// separate manifest to keep in sync. The encoded segment never contains '.',
// so the first dot cleanly separates name from extension.
//
// base64url inflates the URL ~4/3× (worse for non-ASCII after the
// percent-encoding), and filesystems cap names at 255 bytes. URLs whose
// encoding would blow that limit (deep upload paths, signed S3 URLs) get a
// fixed-size SHA-256 name behind HASHED_PREFIX instead. Hashed names can't be
// decoded back to their URL, so the startup index skips them; they're
// re-discovered lazily by a stat() when the URL is next requested.
const MAX_ENCODED_NAME = 200
// '~' is filename-safe and outside the base64url alphabet, so a hashed name
// can never collide with (or be mistaken for) an encoded one.
const HASHED_PREFIX = '~'

export function encodeName(remote: string): string {
  return btoa(encodeURIComponent(remote))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeName(encoded: string): string {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return decodeURIComponent(atob(padded))
}

export function extensionOf(remote: string): string {
  try {
    const match = new URL(remote).pathname.match(/\.[a-z0-9]+$/i)
    return match ? match[0] : ''
  } catch {
    return ''
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function fileNameFor(remote: string): Promise<string> {
  const ext = extensionOf(remote)
  const encoded = encodeName(remote)
  if (encoded.length + ext.length <= MAX_ENCODED_NAME) return encoded + ext
  return HASHED_PREFIX + (await sha256Hex(remote)) + ext
}

export function remoteFromFileName(fileName: string): string | undefined {
  if (fileName.startsWith(HASHED_PREFIX)) return undefined
  const dot = fileName.indexOf('.')
  const encoded = dot === -1 ? fileName : fileName.slice(0, dot)
  try {
    return decodeName(encoded)
  } catch {
    return undefined
  }
}

async function localSrcFor(fileName: string): Promise<string> {
  const { uri } = await Filesystem.getUri({
    directory: Directory.Cache,
    path: `${CACHE_DIR}/${fileName}`
  })
  return Capacitor.convertFileSrc(uri)
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return key !== undefined ? headers[key] : undefined
}

async function downloadAndCache(remote: string): Promise<void> {
  const fileName = await fileNameFor(remote)
  // Hashed names are invisible to the startup index (they don't decode back to
  // a URL), so a cold-launch hit for one is discovered here: stat before
  // spending a download.
  if (fileName.startsWith(HASHED_PREFIX)) {
    try {
      await Filesystem.stat({ directory: Directory.Cache, path: `${CACHE_DIR}/${fileName}` })
      localByRemote.set(remote, await localSrcFor(fileName))
      return
    } catch {
      /* not cached yet — fall through to the download */
    }
  }
  // CapacitorHttp goes through native networking with the shared cookie store,
  // so it carries the Foundry session cookie (same path /join uses) — a raw
  // fetch from the capacitor:// origin would not. 'blob' returns base64 data on
  // native, which Filesystem.writeFile stores as binary when no encoding is set.
  const response = await CapacitorHttp.get({ url: remote, responseType: 'blob' })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Image fetch returned ${response.status}`)
  }
  // CapacitorHttp follows redirects, so an expired session can land on the
  // Foundry /join page with a 200 — without this check that HTML would be
  // cached as the image and served broken on every subsequent launch. Only an
  // explicitly non-image declaration rejects; a missing header is accepted.
  const contentType = headerValue(response.headers, 'content-type')
  if (contentType && !contentType.trim().toLowerCase().startsWith('image/')) {
    throw new Error(`Non-image response (${contentType})`)
  }
  const data = typeof response.data === 'string' ? response.data : ''
  if (!data) throw new Error('Empty image response')
  await Filesystem.writeFile({
    directory: Directory.Cache,
    path: `${CACHE_DIR}/${fileName}`,
    data,
    recursive: true
  })
  localByRemote.set(remote, await localSrcFor(fileName))
}

function pumpQueue(): void {
  while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length) {
    const remote = downloadQueue.shift()!
    activeDownloads++
    downloadAndCache(remote)
      .then(() => failedAt.delete(remote))
      .catch(() => failedAt.set(remote, Date.now()))
      .finally(() => {
        activeDownloads--
        scheduled.delete(remote)
        pumpQueue()
      })
  }
}

function scheduleCache(remote: string): void {
  if (localByRemote.has(remote) || scheduled.has(remote)) return
  const failed = failedAt.get(remote)
  if (failed !== undefined && Date.now() - failed < FAILURE_BACKOFF_MS) return
  if (!indexReady) {
    // Downloading before the index rebuild would race it (and waste a fetch on
    // something already on disk); park the URL and re-schedule after init.
    pendingBeforeInit.add(remote)
    return
  }
  scheduled.add(remote)
  downloadQueue.push(remote)
  // Defer off the render that triggered this — kicking a download mid-render is
  // a side effect we don't want Vue to track — and let the cold-start data
  // requests (active character, world) go out ahead of image traffic.
  queueMicrotask(() => {
    void waitForPriorRequests().then(pumpQueue)
  })
}

/**
 * Resolve a remote image URL to a cached local src when available. On a cache
 * miss returns the remote URL unchanged and warms the cache in the background.
 * Reading the reactive map here makes callers in a render context re-run when
 * the cached copy lands. No-op passthrough off native.
 */
export function cachedImageSrc(remote: string): string {
  if (!isNative()) return remote
  const cached = localByRemote.get(remote)
  if (cached) return cached
  scheduleCache(remote)
  return remote
}

async function deleteCacheFile(name: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ directory: Directory.Cache, path: `${CACHE_DIR}/${name}` })
  } catch {
    /* best effort */
  }
}

// Mirror the Workbox bucket's expiration: drop entries past MAX_AGE_MS (an
// image replaced server-side at the same path would otherwise stay stale
// forever — mtime is the download time), then cap the survivors at MAX_ENTRIES,
// oldest first. Returns the files that remain.
async function prune(files: FileInfo[]): Promise<FileInfo[]> {
  const cutoff = Date.now() - MAX_AGE_MS
  const byAge = [...files].sort((a, b) => a.mtime - b.mtime)
  const firstFresh = byAge.findIndex((f) => f.mtime >= cutoff)
  const expired = firstFresh === -1 ? byAge.length : firstFresh
  const overCap = Math.max(0, byAge.length - expired - MAX_ENTRIES)
  const doomed = byAge.slice(0, expired + overCap)
  await Promise.all(doomed.map(({ name }) => deleteCacheFile(name)))
  return byAge.slice(doomed.length)
}

/**
 * Repopulate the in-memory map from the cache directory so a fresh launch
 * serves previously cached images from disk instead of re-downloading. Safe to
 * call once at startup; a no-op off native.
 */
export async function initImageCache(): Promise<void> {
  if (!isNative()) return
  try {
    await Filesystem.mkdir({ directory: Directory.Cache, path: CACHE_DIR, recursive: true })
  } catch {
    /* already exists */
  }
  try {
    const { files } = await Filesystem.readdir({ directory: Directory.Cache, path: CACHE_DIR })
    const survivors = await prune(files.filter((file) => file.type === 'file'))
    for (const file of survivors) {
      const remote = remoteFromFileName(file.name)
      if (remote) localByRemote.set(remote, Capacitor.convertFileSrc(file.uri))
    }
  } catch {
    /* empty or unreadable cache — fall back to lazy population */
  } finally {
    indexReady = true
    const pending = [...pendingBeforeInit]
    pendingBeforeInit.clear()
    pending.forEach(scheduleCache)
  }
}

// Does this cached URL belong to the given server origin?
function belongsTo(remote: string, origin: string): boolean {
  try {
    return new URL(remote).origin === origin
  } catch {
    return false
  }
}

/**
 * Drop every cached image belonging to a server. Called when the server is
 * forgotten, alongside the actor/chat cache clears, so its assets don't
 * survive a delete + re-add or squat in the entry budget. Hash-named files
 * can't be attributed to an origin, so they're deleted wholesale — they're
 * rare (very long URLs only) and re-cache on demand. No-op off native.
 */
export async function clearImageCacheForServer(origin: string): Promise<void> {
  if (!isNative()) return
  for (const remote of [...localByRemote.keys()]) {
    if (belongsTo(remote, origin)) localByRemote.delete(remote)
  }
  for (const remote of [...failedAt.keys()]) {
    if (belongsTo(remote, origin)) failedAt.delete(remote)
  }
  try {
    const { files } = await Filesystem.readdir({ directory: Directory.Cache, path: CACHE_DIR })
    const doomed = files
      .filter((file) => file.type === 'file')
      .filter(({ name }) => {
        const remote = remoteFromFileName(name)
        return remote ? belongsTo(remote, origin) : name.startsWith(HASHED_PREFIX)
      })
    await Promise.all(doomed.map(({ name }) => deleteCacheFile(name)))
  } catch {
    /* empty or unreadable cache — nothing to clear */
  }
}
