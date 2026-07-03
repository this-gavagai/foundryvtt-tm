import { CapacitorCookies, CapacitorHttp, type HttpResponse } from '@capacitor/core'

import { logger } from '@/utils/utilities'

import {
  classifyJoinResponse,
  JOIN_DATA_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  readBrowserSessionCookie,
  SESSION_CHECK_TIMEOUT_MS,
  VERIFY_CREDENTIALS_TIMEOUT_MS,
  type JoinData,
  type JoinUser,
  type ServerTransport
} from '@/api/serverTransport'

// Sessions are stored per server origin so multiple saved servers don't clobber
// one another's auth. LEGACY_SESSION_KEY is the old single-session key, read as
// a fallback so existing (single-server) users aren't logged out on upgrade.
const SESSION_STORAGE_PREFIX = 'foundrySession:'
const LEGACY_SESSION_KEY = 'foundrySession'

function sessionStorageKey(serverUrl: URL): string {
  return `${SESSION_STORAGE_PREFIX}${serverUrl.origin}`
}

function responseDataAsText(response: HttpResponse): string {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
}

function responseDataAsObject(response: HttpResponse): Record<string, unknown> {
  if (response.data && typeof response.data === 'object') return response.data
  if (typeof response.data !== 'string') return {}
  try {
    const parsed = JSON.parse(response.data)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function readHeader(response: HttpResponse, headerName: string): string | undefined {
  const target = headerName.toLowerCase()
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === target)
  return entry?.[1]
}

function sessionFromSetCookie(setCookie: string | undefined): string | undefined {
  return setCookie?.match(/(?:^|,\s*)session=([^;,]+)/)?.[1]
}

function parseJoinPage(html: string): { users: JoinUser[]; activeUsers: string[] } {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const options = Array.from(
    document.querySelectorAll<HTMLOptionElement>('select[name="userid"] option')
  ).filter((option) => option.value)
  return {
    users: options.map((option) => ({
      _id: option.value,
      name: option.textContent?.trim() ?? option.value,
      role: 0,
      color: ''
    })),
    // Foundry disables options for users who are already signed in; surface
    // them as active so the login form greys them out like the socket path.
    activeUsers: options.filter((option) => option.disabled).map((option) => option.value)
  }
}

async function getNativeJoinData(serverUrl: URL): Promise<JoinData> {
  const response = await CapacitorHttp.get({
    url: new URL('/join', serverUrl).href,
    responseType: 'text',
    connectTimeout: JOIN_DATA_TIMEOUT_MS,
    readTimeout: JOIN_DATA_TIMEOUT_MS
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Join page returned ${response.status}`)
  }
  return { ...parseJoinPage(responseDataAsText(response)), userId: null }
}

async function persistNativeSession(serverUrl: URL, response: HttpResponse) {
  const session =
    sessionFromSetCookie(readHeader(response, 'set-cookie')) ??
    (await CapacitorCookies.getCookies({ url: serverUrl.origin })).session
  if (!session) return
  localStorage.setItem(sessionStorageKey(serverUrl), session)
  // Drop the ambiguous pre-upgrade global session now that this server has its
  // own, so it can never be mis-applied to a different server.
  localStorage.removeItem(LEGACY_SESSION_KEY)
  await CapacitorCookies.setCookie({
    url: serverUrl.origin,
    key: 'session',
    value: session,
    path: '/'
  })
}

export const capacitorServerTransport: ServerTransport = {
  // Per-origin storage is the authoritative source: it's written at login for
  // exactly this server. The webview's document.cookie is origin-blind (it's
  // the app origin's jar, not the server's), so a session cookie found there
  // could belong to any server — it's only a last resort for installs that
  // predate per-origin storage.
  async readSession(serverUrl: URL): Promise<string | undefined> {
    const stored =
      localStorage.getItem(sessionStorageKey(serverUrl)) ??
      localStorage.getItem(LEGACY_SESSION_KEY)
    if (stored) {
      // Keep the native jar in agreement with the sid we're about to hand the
      // socket, so the websocket handshake's Cookie header can't carry a
      // different (stale) session than the query parameter.
      await CapacitorCookies.setCookie({
        url: serverUrl.origin,
        key: 'session',
        value: stored,
        path: '/'
      }).catch(() => {})
      return stored
    }
    return readBrowserSessionCookie() ?? undefined
  },

  async deleteSession(serverUrl: URL): Promise<void> {
    localStorage.removeItem(sessionStorageKey(serverUrl))
    try {
      await CapacitorCookies.deleteCookie({ url: serverUrl.origin, key: 'session' })
    } catch {
      /* best effort — cookie may already be gone */
    }
  },

  async getJoinData(serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData> {
    // On a cold start the socket connects before a session is established, and
    // Foundry answers getJoinData with an *empty* user list rather than an
    // error. An empty-but-successful result must still fall back to the HTTP
    // /join page, which lists users without needing a session — otherwise the
    // login page shows "No users available" until the app is relaunched.
    try {
      const data = await socketJoinData()
      logger.debug('TM-DIAG capacitor getJoinData: socket users', data.users.length)
      if (data.users.length > 0) return data
    } catch (e) {
      logger.debug('TM-DIAG capacitor getJoinData: socket failed', String(e))
      /* socket failed entirely — fall back to the HTTP join page below */
    }
    const httpData = await getNativeJoinData(serverUrl)
    logger.debug('TM-DIAG capacitor getJoinData: http users', httpData.users.length)
    return httpData
  },

  async sessionIsAuthenticated(serverUrl: URL): Promise<boolean | undefined> {
    try {
      // CapacitorHttp attaches the native jar's cookies and follows redirects;
      // an authenticated session lands on /game, an anonymous one gets the
      // join form.
      const response = await CapacitorHttp.get({
        url: new URL('/join', serverUrl).href,
        responseType: 'text',
        connectTimeout: SESSION_CHECK_TIMEOUT_MS,
        readTimeout: SESSION_CHECK_TIMEOUT_MS
      })
      if (response.status < 200 || response.status >= 300) return undefined
      return classifyJoinResponse(response.url, responseDataAsText(response))
    } catch {
      return undefined
    }
  },

  async probe(serverUrl: URL): Promise<boolean> {
    try {
      const response = await CapacitorHttp.get({
        url: new URL('/api/status', serverUrl).href,
        connectTimeout: PROBE_TIMEOUT_MS,
        readTimeout: PROBE_TIMEOUT_MS
      })
      return response.status >= 200 && response.status < 300
    } catch {
      return false
    }
  },

  async verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<boolean> {
    try {
      const response = await CapacitorHttp.post({
        url: new URL('/join', serverUrl).href,
        headers: { 'Content-Type': 'application/json' },
        data: { action: 'join', password, userid },
        connectTimeout: VERIFY_CREDENTIALS_TIMEOUT_MS,
        readTimeout: VERIFY_CREDENTIALS_TIMEOUT_MS
      })
      if (response.status < 200 || response.status >= 300) return false
      const data = responseDataAsObject(response)
      if (data?.status !== 'success') return false
      await persistNativeSession(serverUrl, response)
      return true
    } catch {
      return false
    }
  }
}
