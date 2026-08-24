import { CapacitorCookies, CapacitorHttp, type HttpResponse } from '@capacitor/core'

import { logger } from '@/utils/utilities'

import {
  classifyHomeRedirect,
  classifyJoinPost,
  homeUrl,
  joinRequestBody,
  JOIN_DATA_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  readBrowserSessionCookie,
  sessionCookiePath,
  SESSION_CHECK_TIMEOUT_MS,
  VERIFY_CREDENTIALS_TIMEOUT_MS,
  type JoinAttempt,
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

// The stored sid with no side effects — readSession also plants the cookie, so
// it can't be used to merely *test* whether this server has a session yet.
function readStoredSession(serverUrl: URL): string | undefined {
  return (
    localStorage.getItem(sessionStorageKey(serverUrl)) ??
    localStorage.getItem(LEGACY_SESSION_KEY) ??
    undefined
  )
}

function responseDataAsText(response: HttpResponse): string {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
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

// Fetches the login form's user list over plain HTTP.
//
// NOTE: this signs the session out of the world — Foundry's GET /join handler
// calls sessions.logoutWorld before rendering. That's harmless here (the only
// caller is the login page, where the user is about to pick a user anyway) but
// it means this must never be used to *inspect* a session. Use
// sessionIsAuthenticated for that.
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
  // GET /join mints an anonymous session and hands it back as a Set-Cookie.
  // Keeping it is what lets the *next* socket authenticate: v14 answers
  // getJoinData only for a handshake carrying a session, and on a first launch
  // there is none — while the user list it used to serve in this page's HTML is
  // now rendered client-side, so scraping can't break the deadlock any more.
  // The login page's empty-list path already asks for a fresh socket, which
  // picks this up via readSession.
  //
  // Only when nothing is stored. A session that exists and merely hit a
  // transient socket failure must not be traded for an anonymous one.
  if (!readStoredSession(serverUrl)) await persistNativeSession(serverUrl, response)
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
  // Overwrites whatever the native HTTP stack captured from the response:
  // Foundry sets its own cookie SameSite=Strict, which is never sent on the
  // app's cross-site socket handshake. See sessionCookiePath.
  await CapacitorCookies.setCookie({
    url: serverUrl.origin,
    key: 'session',
    value: session,
    path: sessionCookiePath(serverUrl)
  })
}

export const capacitorServerTransport: ServerTransport = {
  // Per-origin storage is the authoritative source: it's written at login for
  // exactly this server. The webview's document.cookie is origin-blind (it's
  // the app origin's jar, not the server's), so a session cookie found there
  // could belong to any server — it's only a last resort for installs that
  // predate per-origin storage.
  async readSession(serverUrl: URL): Promise<string | undefined> {
    const stored = readStoredSession(serverUrl)
    if (stored) {
      // Keep the native jar in agreement with the sid we're about to hand the
      // socket, so the websocket handshake's Cookie header can't carry a
      // different (stale) session than the query parameter.
      await CapacitorCookies.setCookie({
        url: serverUrl.origin,
        key: 'session',
        value: stored,
        path: sessionCookiePath(serverUrl)
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
    // A socket carrying no session can't produce users on either Foundry
    // generation: v13 answers getJoinData with an *empty* user list rather than
    // an error, and v14 doesn't answer at all. On a first launch there is no
    // session yet, so skip the emit budget (3 attempts x 3s of "Loading
    // users...") and go straight to the HTTP join page, which is what mints the
    // session the next socket will carry.
    if (readStoredSession(serverUrl)) {
      try {
        const data = await socketJoinData()
        logger.debug('TM-DIAG capacitor getJoinData: socket users', data.users.length)
        if (data.users.length > 0) return data
      } catch (e) {
        logger.debug('TM-DIAG capacitor getJoinData: socket failed', String(e))
        /* socket failed entirely — fall back to the HTTP join page below */
      }
    } else {
      logger.debug('TM-DIAG capacitor getJoinData: no session yet, acquiring one over HTTP')
    }
    const httpData = await getNativeJoinData(serverUrl)
    logger.debug('TM-DIAG capacitor getJoinData: http users', httpData.users.length)
    return httpData
  },

  async sessionIsAuthenticated(serverUrl: URL): Promise<boolean | undefined> {
    try {
      // CapacitorHttp attaches the native jar's cookies. Redirects are left
      // unfollowed so the verdict comes from the Location header alone: it's a
      // single tiny round-trip, and it guarantees the probe never actually
      // requests /join (which would sign the session out — see homeUrl).
      const response = await CapacitorHttp.get({
        url: homeUrl(serverUrl).href,
        responseType: 'text',
        disableRedirects: true,
        connectTimeout: SESSION_CHECK_TIMEOUT_MS,
        readTimeout: SESSION_CHECK_TIMEOUT_MS
      })
      // A platform that followed the redirect anyway still answers correctly
      // via the final URL.
      return classifyHomeRedirect(readHeader(response, 'location') ?? response.url, serverUrl)
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

  async verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<JoinAttempt> {
    try {
      // Non-2xx resolves here rather than throwing (both native HTTP handlers
      // read the error stream into the response), so Foundry's 401 body is
      // available to tell a bad password from an outage.
      const response = await CapacitorHttp.post({
        url: new URL('/join', serverUrl).href,
        headers: { 'Content-Type': 'application/json' },
        data: joinRequestBody(userid, password),
        connectTimeout: VERIFY_CREDENTIALS_TIMEOUT_MS,
        readTimeout: VERIFY_CREDENTIALS_TIMEOUT_MS
      })
      const bodyText = responseDataAsText(response)
      const result = classifyJoinPost(response.status, bodyText)
      if (result === 'ok') await persistNativeSession(serverUrl, response)
      // See the browser transport: Foundry's plain-text error key is the only
      // account of why a login failed, so it goes to the log verbatim.
      else logger.debug('TM-DIAG join POST refused', response.status, bodyText)
      return result
    } catch {
      return 'unavailable'
    }
  }
}
