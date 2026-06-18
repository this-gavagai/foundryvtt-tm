import {
  readBrowserSessionCookie,
  VERIFY_CREDENTIALS_TIMEOUT_MS,
  type JoinData,
  type ServerTransport
} from '@/api/serverTransport'

export const browserServerTransport: ServerTransport = {
  readSession: readBrowserSessionCookie,

  getJoinData(_serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData> {
    return socketJoinData()
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
