import { logger } from '@/utils/utilities'

import {
  classifyHomeRedirect,
  classifyJoinPost,
  homeUrl,
  joinRequestBody,
  readBrowserSessionCookie,
  PROBE_TIMEOUT_MS,
  SESSION_CHECK_TIMEOUT_MS,
  VERIFY_CREDENTIALS_TIMEOUT_MS,
  type JoinAttempt,
  type JoinData,
  type ServerTransport
} from '@/api/serverTransport'

export const browserServerTransport: ServerTransport = {
  readSession: readBrowserSessionCookie,

  // In browser mode the app is served by the Foundry host itself, so the
  // session lives in that origin's own cookie jar — nothing app-managed to
  // delete, and there's no multi-server list here either.
  deleteSession() {},

  // Socket first — a page opened from a Foundry the user is already signed into
  // has the session cookie, and the emit answers straight away.
  //
  // The fallback exists because v14 registers a socket's event listeners only
  // for a handshake whose Cookie header names a session it knows (see
  // server/sockets.mjs: no session → `emit("session", null)` and an early
  // return, before a single `socket.on` is wired). So a browser with no Foundry
  // session — a first visit, or one whose cookie has aged out; Foundry sets a
  // 24h Max-Age — gets a socket that answers getJoinData with silence forever,
  // and the login page would sit on "Loading users…" with nothing to load.
  //
  // GET /join is the only route that mints a session (neither the home route
  // nor the module's own static files do), and the cookie it sets is HttpOnly,
  // so this can't be predicted from document.cookie — the socket attempt has to
  // fail first. The minted session belongs to the *next* socket (this one is
  // bound server-side to no session at all), so we report an empty list, which
  // is what the login page's retry path already reads as "ask for a fresh
  // socket and try again".
  //
  // It also signs the session out of the world, which is why the socket must go
  // first: this only ever runs from the login page (the sole caller), where the
  // session is already known-anonymous, so there is nothing left to lose.
  async getJoinData(serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData> {
    try {
      const data = await socketJoinData()
      if (data.users.length > 0) return data
      logger.debug('TM-DIAG browser getJoinData: socket returned no users')
    } catch (e) {
      logger.debug('TM-DIAG browser getJoinData: socket failed', String(e))
    }
    logger.debug('TM-DIAG browser getJoinData: minting a session over HTTP')
    // Same-origin, so the Set-Cookie lands in the page's own jar. A failure here
    // leaves the caller exactly where it already was.
    await fetch(new URL('/join', serverUrl), { credentials: 'same-origin' }).catch(() => {})
    return { users: [], activeUsers: [], userId: null }
  },

  async sessionIsAuthenticated(serverUrl: URL): Promise<boolean | undefined> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS)
    try {
      // Same-origin fetch carries the session cookie. `redirect: 'manual'`
      // isn't usable here — it yields an opaque response with no readable
      // Location — so we follow and read where we landed instead.
      const response = await fetch(homeUrl(serverUrl), { signal: controller.signal })
      if (!response.ok) return undefined
      return classifyHomeRedirect(response.url, serverUrl)
    } catch {
      return undefined
    } finally {
      clearTimeout(timeoutId)
    }
  },

  async probe(serverUrl: URL): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const response = await fetch(new URL('/api/status', serverUrl), { signal: controller.signal })
      return response.ok
    } catch {
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  },

  async verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<JoinAttempt> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), VERIFY_CREDENTIALS_TIMEOUT_MS)
    try {
      const response = await fetch(new URL('/join', serverUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(joinRequestBody(userid, password)),
        signal: controller.signal
      })
      const bodyText = await response.text()
      const result = classifyJoinPost(response.status, bodyText)
      // Foundry's refusals are un-localized keys in a plain-text body, and they
      // are the only account we get of *why* a login failed. Logged verbatim
      // (never the password) so the next contract change is one line of console
      // away from being named, instead of an unexplained "login failed".
      if (result !== 'ok') logger.debug('TM-DIAG join POST refused', response.status, bodyText)
      return result
    } catch {
      // Aborted or the network is gone — nothing was learned about the
      // credential, so this must not read as a rejection.
      return 'unavailable'
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
