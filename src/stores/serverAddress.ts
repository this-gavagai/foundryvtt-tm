import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor } from '@capacitor/core'
import { browserServerTransport } from '@/api/browserServerTransport'
import { capacitorServerTransport } from '@/api/capacitorServerTransport'
import { forgetLoginUser } from '@/stores/user'
import { useWorldStore } from '@/stores/world'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { clearActorSnapshotsForServer } from '@/utils/actorCache'
import { clearChatCacheForServer } from '@/utils/chatCache'
import { clearImageCacheForServer } from '@/api/imageCache'
import { rejectAllPending } from '@/api/actionRpc'
import { clearLastCharacterId } from '@/utils/utilities'

const ACTIVE_URL_STORAGE_KEY = 'tablemate.serverUrl'
const SERVERS_STORAGE_KEY = 'tablemate.servers'
const DEFAULT_PROTOCOL = 'http://'

function isNativeMobileBuild(): boolean {
  const platform = Capacitor.getPlatform()
  return Capacitor.isNativePlatform() && (platform === 'ios' || platform === 'android')
}

function hasExplicitProtocol(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim())
}

function normalizeServerUrl(input: string): URL {
  const trimmed = input.trim()
  const withProtocol = hasExplicitProtocol(trimmed) ? trimmed : `${DEFAULT_PROTOCOL}${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server URL must use HTTP or HTTPS')
  }
  return new URL(url.origin)
}

// A server is identified by its host (hostname + port) regardless of protocol:
// a single port serves only one of http/https, so https://foo:30000 and
// http://foo:30000 are the same endpoint and must not both appear in the list.
function serverKey(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

// Candidate URLs to try for a user-typed address, in priority order. When the
// user named a protocol we honour exactly that one; otherwise we try https
// first and fall back to http. Throws if the input can't form a valid URL.
export function serverUrlCandidates(input: string): URL[] {
  const trimmed = input.trim()
  if (hasExplicitProtocol(trimmed)) return [normalizeServerUrl(trimmed)]
  return [normalizeServerUrl(`https://${trimmed}`), normalizeServerUrl(`http://${trimmed}`)]
}

function readActiveServerUrl(): URL | undefined {
  const stored = localStorage.getItem(ACTIVE_URL_STORAGE_KEY)
  if (!stored) return undefined
  try {
    return normalizeServerUrl(stored)
  } catch {
    localStorage.removeItem(ACTIVE_URL_STORAGE_KEY)
    return undefined
  }
}

// Build the saved-server list from storage, normalising each entry and
// dropping duplicates/invalid values. A legacy single active URL (from before
// multi-server support) is folded into the list so it isn't lost on upgrade.
function readStoredServers(): string[] {
  const servers: string[] = []
  const add = (value: string) => {
    try {
      const origin = normalizeServerUrl(value).origin
      if (!servers.some((s) => serverKey(s) === serverKey(origin))) servers.push(origin)
    } catch {
      /* skip malformed entry */
    }
  }

  const raw = localStorage.getItem(SERVERS_STORAGE_KEY)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const entry of parsed) if (typeof entry === 'string') add(entry)
      }
    } catch {
      /* corrupt list — start fresh */
    }
  }

  const legacyActive = localStorage.getItem(ACTIVE_URL_STORAGE_KEY)
  if (legacyActive) add(legacyActive)

  return servers
}

export const useServerAddressStore = defineStore('serverAddress', () => {
  const isNativeMobile = ref(isNativeMobileBuild())
  const servers = ref<string[]>(isNativeMobile.value ? readStoredServers() : [])
  const serverUrl = ref<URL | undefined>(
    isNativeMobile.value ? readActiveServerUrl() : new URL(window.location.origin)
  )
  const serverUrlText = computed(() => serverUrl.value?.origin ?? '')
  const needsServerUrl = computed(() => isNativeMobile.value && !serverUrl.value)
  // Set when the user explicitly asks to add a new server (vs. just landing on
  // the gate). The gate consumes it once to pre-select its "New" option.
  const pendingNewServer = ref(false)

  // The origin whose characters/world are currently held in memory. Tracked
  // separately from serverUrl because serverUrl is cleared to undefined while
  // the gate is showing (clearActiveServer), which would otherwise lose the
  // comparison needed to detect a genuine server *switch* on the next activate.
  let loadedOrigin = serverUrl.value?.origin

  function persistServers() {
    if (!isNativeMobile.value) return
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(servers.value))
  }

  // One entry per host. If the host is already known, refresh it to the given
  // origin so the saved protocol tracks whichever one actually connected (the
  // active-server highlight and re-selection both compare full origins).
  function rememberServer(origin: string) {
    const key = serverKey(origin)
    const idx = servers.value.findIndex((s) => serverKey(s) === key)
    if (idx === -1) {
      servers.value = [...servers.value, origin]
    } else if (servers.value[idx] !== origin) {
      const next = [...servers.value]
      next[idx] = origin
      servers.value = next
    } else {
      return
    }
    persistServers()
  }

  // Assign the active server. A fresh URL instance is always created so the
  // serverUrl ref changes identity even when re-selecting the same origin —
  // useSession watches this ref and (re)connects on every change.
  function activate(url: URL) {
    // Detect a genuine switch *before* mutating serverUrl. A same-origin
    // reactivation (reconnect) is left untouched, preserving the seamless-resume
    // world.
    const switching = !!loadedOrigin && loadedOrigin !== url.origin
    loadedOrigin = url.origin
    serverUrl.value = url
    if (isNativeMobile.value) localStorage.setItem(ACTIVE_URL_STORAGE_KEY, url.origin)

    // Switching to a *different* server: drop the previous server's in-memory
    // world and reset world *status* to pending so the UI can't paint a stale
    // "ready" screen for the old server. Then re-point the selection at the new
    // server's own remembered character — seeding it now (serverUrl is already
    // updated above, so per-server lookups resolve to the new server) lets that
    // character's cached snapshot paint immediately instead of waiting for the
    // full world refresh. Cross-server bleed is prevented because the selection,
    // caches, and world status are all keyed per origin.
    if (switching) {
      // RPCs pending against the old server can never be answered by the new
      // one — reject them now instead of letting each time out after 30s.
      // Same-origin reactivation deliberately does NOT flush: those acks are
      // uuid-keyed broadcasts that still arrive on the replacement socket.
      rejectAllPending('server changed')
      useWorldStore().clearWorld()
      useFoundryWorldStatusStore().markWorldPending()
      useCharacterSelectStore().reseedForCurrentServer()
    }
  }

  // Join an already-resolved server URL (protocol decided upstream by
  // serverUrlCandidates + a reachability probe): remember it and make it active.
  function commitServerUrl(url: URL) {
    rememberServer(url.origin)
    activate(url)
  }

  // Switch the active server to one already in the stored list.
  function selectServer(origin: string): URL {
    const normalized = normalizeServerUrl(origin)
    rememberServer(normalized.origin)
    activate(normalized)
    return normalized
  }

  // Forget a stored server, including its stored session/cookie and all of its
  // cached data, so re-adding it starts clean (unauthenticated, no stale
  // characters or chat). If it was the active one, fall back to the gate.
  function removeServer(origin: string) {
    servers.value = servers.value.filter((s) => s !== origin)
    persistServers()
    const transport = isNativeMobile.value ? capacitorServerTransport : browserServerTransport
    try {
      void Promise.resolve(transport.deleteSession(new URL(origin))).catch(() => {})
    } catch {
      /* malformed origin — nothing to delete */
    }
    forgetLoginUser(origin)
    // Drop this server's per-origin caches so they can't survive a delete +
    // re-add. Best-effort and fire-and-forget — the IDB helpers never reject.
    void clearActorSnapshotsForServer(origin)
    void clearChatCacheForServer(origin)
    void clearImageCacheForServer(origin)
    clearLastCharacterId(origin)
    if (serverUrl.value?.origin === origin) clearActiveServer()
  }

  // Deactivate the current server without forgetting it — returns the app to
  // the ServerUrlGate (e.g. when the user cancels a stuck connection).
  function clearActiveServer() {
    // No server to answer them anymore — fail pending RPCs immediately.
    rejectAllPending('server cleared')
    serverUrl.value = isNativeMobile.value ? undefined : new URL(window.location.origin)
    if (isNativeMobile.value) localStorage.removeItem(ACTIVE_URL_STORAGE_KEY)
  }

  // "Add a new server": drop the active server (sending the app back to the
  // gate) and flag that the gate should open straight onto its "New" option.
  function requestNewServer() {
    pendingNewServer.value = true
    clearActiveServer()
  }

  // Read-and-reset the pending-new-server intent. The gate calls this once on
  // mount so a later visit (e.g. after a connection error) doesn't force "New".
  function consumePendingNewServer(): boolean {
    const wanted = pendingNewServer.value
    pendingNewServer.value = false
    return wanted
  }

  return {
    isNativeMobile,
    servers,
    serverUrl,
    serverUrlText,
    needsServerUrl,
    commitServerUrl,
    selectServer,
    removeServer,
    clearActiveServer,
    requestNewServer,
    consumePendingNewServer
  }
})
