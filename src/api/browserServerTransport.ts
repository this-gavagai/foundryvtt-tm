import {
  classifyJoinResponse,
  readBrowserSessionCookie,
  PROBE_TIMEOUT_MS,
  SESSION_CHECK_TIMEOUT_MS,
  VERIFY_CREDENTIALS_TIMEOUT_MS,
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
      // Same-origin fetch carries the session cookie; Foundry redirects an
      // authenticated session away from /join to /game.
      const response = await fetch(new URL('/join', serverUrl), { signal: controller.signal })
      if (!response.ok) return undefined
      return classifyJoinResponse(response.url, await response.text())
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

  async verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), VERIFY_CREDENTIALS_TIMEOUT_MS)
    try {
      const response = await fetch(new URL('/join', serverUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', password, userid }),
        signal: controller.signal
      })
      if (!response.ok) return false
      const data = await response.json()
      return data?.status === 'success'
    } catch {
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
