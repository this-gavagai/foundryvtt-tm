import { reactive } from 'vue'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem, type FileInfo } from '@capacitor/filesystem'

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
// cached src; on a miss it returns the remote URL (so nothing blanks) and
// kicks off a one-time background download into Directory.Cache. The lookup map
// is reactive, so once a file lands every template <img :src="getPath(...)">
// re-renders and swaps from the remote URL to a local file:// URI. Subsequent
// launches repopulate the map from the cache directory and serve from disk.

const CACHE_DIR = 'tablemate-image-cache'
const MAX_ENTRIES = 300
const FAILURE_BACKOFF_MS = 5 * 60 * 1000

// remote absolute URL -> webview-loadable local src (convertFileSrc of the
// cached file). reactive so a render that read a miss re-runs on the hit.
const localByRemote = reactive(new Map<string, string>())
// In-flight downloads, so repeated renders during a download don't pile up
// duplicate fetches. Failed downloads back off for a while before retrying.
const inflight = new Set<string>()
const failedAt = new Map<string, number>()
let indexReady = false

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

// Filenames are the base64url-encoded remote URL plus the original extension,
// so the in-memory map can be rebuilt from a directory listing alone — no
// separate manifest to keep in sync. The encoded segment never contains '.',
// so the first dot cleanly separates name from extension.
function encodeName(remote: string): string {
  return btoa(encodeURIComponent(remote))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decodeName(encoded: string): string {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return decodeURIComponent(atob(padded))
}

function extensionOf(remote: string): string {
  try {
    const match = new URL(remote).pathname.match(/\.[a-z0-9]+$/i)
    return match ? match[0] : ''
  } catch {
    return ''
  }
}

function fileNameFor(remote: string): string {
  return encodeName(remote) + extensionOf(remote)
}

function remoteFromFileName(fileName: string): string | undefined {
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

async function downloadAndCache(remote: string): Promise<void> {
  const fileName = fileNameFor(remote)
  // CapacitorHttp goes through native networking with the shared cookie store,
  // so it carries the Foundry session cookie (same path /join uses) — a raw
  // fetch from the capacitor:// origin would not. 'blob' returns base64 data on
  // native, which Filesystem.writeFile stores as binary when no encoding is set.
  const response = await CapacitorHttp.get({ url: remote, responseType: 'blob' })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Image fetch returned ${response.status}`)
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

function scheduleCache(remote: string): void {
  if (!indexReady || localByRemote.has(remote) || inflight.has(remote)) return
  const failed = failedAt.get(remote)
  if (failed !== undefined && Date.now() - failed < FAILURE_BACKOFF_MS) return

  inflight.add(remote)
  // Defer off the render that triggered this — kicking a download mid-render is
  // a side effect we don't want Vue to track.
  queueMicrotask(() => {
    downloadAndCache(remote)
      .then(() => failedAt.delete(remote))
      .catch(() => failedAt.set(remote, Date.now()))
      .finally(() => inflight.delete(remote))
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

// Keep the cache bounded, mirroring the browser's Workbox limit. Deletes the
// oldest files (by mtime) once the directory exceeds MAX_ENTRIES, returning the
// survivors.
async function pruneToLimit(files: FileInfo[]): Promise<FileInfo[]> {
  if (files.length <= MAX_ENTRIES) return files
  const byAge = [...files].sort((a, b) => a.mtime - b.mtime)
  const doomed = byAge.slice(0, byAge.length - MAX_ENTRIES)
  await Promise.all(
    doomed.map(async ({ name }) => {
      try {
        await Filesystem.deleteFile({ directory: Directory.Cache, path: `${CACHE_DIR}/${name}` })
      } catch {
        /* best effort */
      }
    })
  )
  return byAge.slice(byAge.length - MAX_ENTRIES)
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
    const survivors = await pruneToLimit(files.filter((file) => file.type === 'file'))
    for (const file of survivors) {
      const remote = remoteFromFileName(file.name)
      if (remote) localByRemote.set(remote, Capacitor.convertFileSrc(file.uri))
    }
  } catch {
    /* empty or unreadable cache — fall back to lazy population */
  } finally {
    indexReady = true
  }
}
