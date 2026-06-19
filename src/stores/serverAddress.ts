import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor } from '@capacitor/core'

const ACTIVE_URL_STORAGE_KEY = 'tablemate.serverUrl'
const SERVERS_STORAGE_KEY = 'tablemate.servers'
const DEFAULT_PROTOCOL = 'http://'

function isNativeMobileBuild(): boolean {
  const platform = Capacitor.getPlatform()
  return Capacitor.isNativePlatform() && (platform === 'ios' || platform === 'android')
}

function normalizeServerUrl(input: string): URL {
  const trimmed = input.trim()
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${DEFAULT_PROTOCOL}${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server URL must use HTTP or HTTPS')
  }
  return new URL(url.origin)
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
      if (!servers.includes(origin)) servers.push(origin)
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

  function persistServers() {
    if (!isNativeMobile.value) return
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(servers.value))
  }

  function rememberServer(origin: string) {
    if (servers.value.includes(origin)) return
    servers.value = [...servers.value, origin]
    persistServers()
  }

  // Assign the active server. A fresh URL instance is always created so the
  // serverUrl ref changes identity even when re-selecting the same origin —
  // useSession watches this ref and (re)connects on every change.
  function activate(url: URL) {
    serverUrl.value = url
    if (isNativeMobile.value) localStorage.setItem(ACTIVE_URL_STORAGE_KEY, url.origin)
  }

  // Join a typed-in server: remember it and make it active.
  function setServerUrl(input: string): URL {
    const normalized = normalizeServerUrl(input)
    rememberServer(normalized.origin)
    activate(normalized)
    return normalized
  }

  // Switch the active server to one already in the stored list.
  function selectServer(origin: string): URL {
    const normalized = normalizeServerUrl(origin)
    rememberServer(normalized.origin)
    activate(normalized)
    return normalized
  }

  // Forget a stored server. If it was the active one, fall back to the gate.
  function removeServer(origin: string) {
    servers.value = servers.value.filter((s) => s !== origin)
    persistServers()
    if (serverUrl.value?.origin === origin) clearActiveServer()
  }

  // Deactivate the current server without forgetting it — returns the app to
  // the ServerUrlGate (e.g. when the user cancels a stuck connection).
  function clearActiveServer() {
    serverUrl.value = isNativeMobile.value ? undefined : new URL(window.location.origin)
    if (isNativeMobile.value) localStorage.removeItem(ACTIVE_URL_STORAGE_KEY)
  }

  return {
    isNativeMobile,
    servers,
    serverUrl,
    serverUrlText,
    needsServerUrl,
    setServerUrl,
    selectServer,
    removeServer,
    clearActiveServer
  }
})
