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

// Foundry mints a session on any route through its session middleware, and
// /api/status is one of them (a redirect like GET / is not). Unlike /join it
// has no side effect on the session it hands back — /join signs it out of the
// world — so this is the route to ask for a session with.
function requestStatus(serverUrl: URL): Promise<HttpResponse> {
  return CapacitorHttp.get({
    url: new URL('/api/status', serverUrl).href,
    connectTimeout: PROBE_TIMEOUT_MS,
    readTimeout: PROBE_TIMEOUT_MS
  })
}

// One in-flight mint per origin, so a socket being established and a repair
// asking at the same moment share the request rather than racing two sessions.
const pendingMints = new Map<string, Promise<string | undefined>>()

// Acquire a session for a server we hold none for. Foundry recognizes a socket
// by the session in its handshake and nothing else: without one it emits
// `session: null`, registers no event listeners at all, and every emit —
// getJoinData included — goes unanswered forever (verified against 14.367).
// Minting here is what lets the *first* socket be a working one, instead of
// spending it to discover it is deaf and having the login page ask for another.
function mintNativeSession(serverUrl: URL): Promise<string | undefined> {
  const key = serverUrl.origin
  const inFlight = pendingMints.get(key)
  if (inFlight) return inFlight
  const attempt = (async () => {
    try {
      const response = await requestStatus(serverUrl)
      if (response.status < 200 || response.status >= 300) return undefined
      await persistNativeSession(serverUrl, response)
      return readStoredSession(serverUrl)
    } catch {
      // Unreachable, or a server that isn't Foundry. The socket is attempted
      // session-less all the same, exactly as it was before.
      return undefined
    } finally {
      pendingMints.delete(key)
    }
  })()
  pendingMints.set(key, attempt)
  return attempt
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

// NOTE: requesting /join signs the session out of the world — Foundry's GET
// /join handler calls sessions.logoutWorld before rendering. That's harmless
// for the callers below (they run from the login page, where the user is about
// to pick a user anyway) but it means this must never be used to *inspect* a
// session. Use sessionIsAuthenticated for that.
function requestJoinPage(serverUrl: URL): Promise<HttpResponse> {
  return CapacitorHttp.get({
    url: new URL('/join', serverUrl).href,
    responseType: 'text',
    connectTimeout: JOIN_DATA_TIMEOUT_MS,
    readTimeout: JOIN_DATA_TIMEOUT_MS
  })
}

// Fetches the login form's user list over plain HTTP, and keeps the session the
// request mints.
async function getNativeJoinData(serverUrl: URL): Promise<JoinData> {
  let response = await requestJoinPage(serverUrl)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Join page returned ${response.status}`)
  }
  // A session already sitting in the jar that we have no record of (its sid was
  // never readable — see persistNativeSession) makes this request come back
  // with nothing to keep, because Foundry mints only for a request that carried
  // no session. Clearing the jar and asking again forces a mint we can actually
  // read, rather than leaving the socket to handshake anonymously forever.
  if (!(await keepJoinSession(serverUrl, response))) {
    logger.debug('TM-DIAG capacitor join page returned no session — re-minting')
    await capacitorServerTransport.deleteSession(serverUrl)
    response = await requestJoinPage(serverUrl)
    await keepJoinSession(serverUrl, response)
  }
  return { ...parseJoinPage(responseDataAsText(response)), userId: null }
}

// Take the session the join page just handed us, and report whether the app is
// left holding one at all.
//
// A Set-Cookie is proof Foundry did *not* accept the session we sent, since it
// only ever mints for a request that carried none — so whatever we had stored
// is dead (a server restart drops its session table) and the new one replaces
// it. That trade is safe here and only here: the login page is the sole caller,
// so the session being replaced is already anonymous or unrecognized. Absent
// that header Foundry took ours, and a merely transient socket failure must not
// cost us a session that works.
async function keepJoinSession(serverUrl: URL, response: HttpResponse): Promise<boolean> {
  const minted = sessionFromSetCookie(readHeader(response, 'set-cookie'))
  if (minted) return storeNativeSession(serverUrl, minted)
  if (readStoredSession(serverUrl)) return true
  // Foundry minted nothing and we hold no record of one: the jar's own copy is
  // the last chance, for installs whose session was captured before this code
  // started keeping it.
  const inJar = (await CapacitorCookies.getCookies({ url: serverUrl.origin })).session
  return inJar ? storeNativeSession(serverUrl, inJar) : false
}

// Keep the session this response minted, reporting whether one was found. The
// sid is only ever legible in a Set-Cookie header (Foundry's cookie is
// HttpOnly, and the app's own document.cookie jar belongs to the WebView
// origin, not the server's), so a response that set no cookie leaves us with
// nothing — which is a *recoverable* state the caller has to know about.
async function persistNativeSession(serverUrl: URL, response: HttpResponse): Promise<boolean> {
  const session =
    sessionFromSetCookie(readHeader(response, 'set-cookie')) ??
    (await CapacitorCookies.getCookies({ url: serverUrl.origin })).session
  if (!session) return false
  return storeNativeSession(serverUrl, session)
}

async function storeNativeSession(serverUrl: URL, session: string): Promise<boolean> {
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
  return true
}

export const capacitorServerTransport: ServerTransport = {
  // Per-origin storage is the authoritative source: it's written at login for
  // exactly this server. The webview's document.cookie is origin-blind (it's
  // the app origin's jar, not the server's), so a session cookie found there
  // could belong to any server — it's only a last resort for installs that
  // predate per-origin storage.
  async readSession(serverUrl: URL): Promise<string | undefined> {
    // Minting one when there is none is what makes the socket about to be
    // opened a socket that can answer anything (see mintNativeSession). The
    // login page used to arrive at a deaf first socket, wait out getJoinData's
    // whole retry budget, fetch the join page for a session, and only then —
    // via its own "no users" retry — get a socket worth talking to. Hence a
    // first attempt that always failed and a Retry that always worked.
    const stored = readStoredSession(serverUrl) ?? (await mintNativeSession(serverUrl))
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
      const reachable = response.status >= 200 && response.status < 300
      // /api/status runs through Foundry's session middleware, so this probe
      // *mints* a session of its own — and Foundry only sends a Set-Cookie to a
      // request that carried none, so the login page's GET /join then comes
      // back with no sid to keep. Keeping the probe's is what stops a bare-host
      // address (which is the only kind that gets probed, to choose https over
      // http) from reaching the login page session-less: the socket would
      // handshake anonymously, v14 would wire no listeners for it, and the user
      // list would never arrive. Typing the protocol skipped the probe, which
      // is why that spelling of the same server worked.
      if (reachable && !readStoredSession(serverUrl)) {
        await persistNativeSession(serverUrl, response)
      }
      return reachable
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
