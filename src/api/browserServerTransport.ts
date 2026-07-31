import {
  classifyHomeRedirect,
  classifyJoinPost,
  homeUrl,
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

  getJoinData(_serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData> {
    return socketJoinData()
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
        body: JSON.stringify({ action: 'join', password, userid }),
        signal: controller.signal
      })
      return classifyJoinPost(response.status, await response.text())
    } catch {
      // Aborted or the network is gone — nothing was learned about the
      // credential, so this must not read as a rejection.
      return 'unavailable'
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
