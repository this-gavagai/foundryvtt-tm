// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'

// How the native build gets hold of a Foundry session, and the one asymmetry
// that used to break it.
//
// Foundry sends a Set-Cookie only to a request that carried no session of its
// own — every later request just re-presents the cookie it already planted. The
// sid is HttpOnly, and the WebView's document.cookie belongs to the app origin
// rather than the server's, so that header is the app's only sight of it.
//
// The reachability probe (GET /api/status) runs through the session middleware
// and therefore mints one. So a bare-host address like "vtt.example.com" — the
// only kind that gets probed, to choose https over http — spent its session on
// the probe, and the login page's GET /join came back with nothing to keep. The
// socket then handshaked anonymously, v14 wired no listeners for it, and the
// user list never arrived; typing "https://vtt.example.com" skipped the probe
// and worked. Both halves of the repair are pinned here.

const httpGet = vi.fn()
const getCookies = vi.fn(() => Promise.resolve({}))
const setCookie = vi.fn(() => Promise.resolve())
const deleteCookie = vi.fn(() => Promise.resolve())

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    get: (options: unknown) => httpGet(options),
    post: (options: unknown) => httpGet(options)
  },
  CapacitorCookies: {
    getCookies: (options: unknown) => getCookies(options),
    setCookie: (options: unknown) => setCookie(options),
    deleteCookie: (options: unknown) => deleteCookie(options)
  }
}))

vi.mock('@/utils/utilities', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { capacitorServerTransport } = await import('@/api/capacitorServerTransport')

const SERVER = new URL('https://vtt.example.com/')
const SESSION_KEY = 'foundrySession:https://vtt.example.com'

// A minted session, as Foundry hands it back.
const withSession = (sid: string, data = '') => ({
  status: 200,
  data,
  headers: {
    'Set-Cookie': `session=${sid}; Max-Age=86400; Path=/; HttpOnly; SameSite=Strict`
  },
  url: SERVER.href
})
// The same request once a session cookie is already in the jar.
const withoutSession = (data = '') => ({
  status: 200,
  data,
  headers: { 'Content-Type': 'text/html' },
  url: SERVER.href
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  getCookies.mockResolvedValue({})
})

describe('capacitorServerTransport.probe', () => {
  it('keeps the session its status request minted', async () => {
    httpGet.mockResolvedValue(withSession('probe-sid', { active: true }))

    expect(await capacitorServerTransport.probe(SERVER)).toBe(true)
    expect(localStorage.getItem(SESSION_KEY)).toBe('probe-sid')
    // Foundry's own cookie is SameSite=Strict, which is never sent on the
    // app's cross-site socket handshake — the stored sid is re-planted with
    // attributes that are.
    expect(setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'probe-sid', path: '/; SameSite=None; Secure' })
    )
  })

  it('leaves an existing session alone', async () => {
    localStorage.setItem(SESSION_KEY, 'logged-in-sid')
    httpGet.mockResolvedValue(withSession('probe-sid', { active: true }))

    expect(await capacitorServerTransport.probe(SERVER)).toBe(true)
    expect(localStorage.getItem(SESSION_KEY)).toBe('logged-in-sid')
  })

  it('stores nothing for a server that never answers', async () => {
    httpGet.mockRejectedValue(new Error('unreachable'))

    expect(await capacitorServerTransport.probe(SERVER)).toBe(false)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('capacitorServerTransport.getJoinData', () => {
  const socketSilence = () => Promise.reject(new Error('getJoinData timed out'))

  it('goes straight to the socket once a session is stored', async () => {
    localStorage.setItem(SESSION_KEY, 'probe-sid')
    const users = [{ _id: 'u1', name: 'Alice', role: 1, color: '#fff' }]

    const data = await capacitorServerTransport.getJoinData(SERVER, () =>
      Promise.resolve({ users, activeUsers: [], userId: null })
    )

    expect(data.users).toEqual(users)
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('re-mints when the join page answers with no session to keep', async () => {
    // A session is in the native jar (planted by something whose Set-Cookie we
    // never saw), so Foundry has no reason to send another — and its sid is
    // unreadable from here. Clearing the jar and asking again is the only way
    // back to a session the socket can actually use.
    httpGet.mockResolvedValueOnce(withoutSession()).mockResolvedValueOnce(withSession('fresh-sid'))

    await capacitorServerTransport.getJoinData(SERVER, socketSilence)

    expect(deleteCookie).toHaveBeenCalledWith({ url: SERVER.origin, key: 'session' })
    expect(httpGet).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(SESSION_KEY)).toBe('fresh-sid')
  })

  it('asks only once when the join page mints a session', async () => {
    httpGet.mockResolvedValue(withSession('join-sid'))

    await capacitorServerTransport.getJoinData(SERVER, socketSilence)

    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(deleteCookie).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_KEY)).toBe('join-sid')
  })
})
