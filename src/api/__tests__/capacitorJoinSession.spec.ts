// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'

// How the native build gets hold of a Foundry session — the thing every socket
// it opens is worth nothing without.
//
// Foundry recognizes a socket by the session in its handshake and by nothing
// else: without one it emits `session: null`, registers no event listeners at
// all, and every emit (getJoinData included) goes unanswered forever. And it
// hands out a session only to a request that carried none — every later request
// just re-presents the cookie it already planted. The sid is HttpOnly, and the
// WebView's document.cookie belongs to the app origin rather than the server's,
// so that response header is the app's only sight of it.
//
// Two bugs came out of that, both pinned here. A bare-host address like
// "vtt.example.com" — the only kind that gets probed, to choose https over http
// — spent its session on the reachability probe (GET /api/status runs through
// the session middleware), so the login page's GET /join came back with nothing
// to keep and the user list never arrived at all; typing the protocol skipped
// the probe and worked. And every session-less first socket was deaf by
// construction, which is why the login page's first attempt failed and Retry
// succeeded.

const httpGet = vi.fn()
const getCookies = vi.fn((_options: unknown) => Promise.resolve({}))
const setCookie = vi.fn((_options: unknown) => Promise.resolve())
const deleteCookie = vi.fn((_options: unknown) => Promise.resolve())

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
const withSession = (sid: string, data: unknown = '') => ({
  status: 200,
  data,
  headers: {
    'Set-Cookie': `session=${sid}; Max-Age=86400; Path=/; HttpOnly; SameSite=Strict`
  },
  url: SERVER.href
})
// The same request once a session cookie is already in the jar.
const withoutSession = (data: unknown = '') => ({
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

describe('capacitorServerTransport.readSession', () => {
  it('mints a session for a server it holds none for', async () => {
    // Foundry recognizes a socket by the session in its handshake and nothing
    // else: without one it registers no event listeners, so every emit —
    // getJoinData included — is answered with silence. The socket about to be
    // opened has to carry one, or it is deaf from birth.
    httpGet.mockResolvedValue(withSession('minted-sid', { active: true }))

    expect(await capacitorServerTransport.readSession(SERVER)).toBe('minted-sid')
    expect(String(httpGet.mock.calls[0][0].url)).toBe('https://vtt.example.com/api/status')
    expect(localStorage.getItem(SESSION_KEY)).toBe('minted-sid')
  })

  it('asks once when two sockets are established at the same moment', async () => {
    httpGet.mockResolvedValue(withSession('minted-sid', { active: true }))

    const [a, b] = await Promise.all([
      capacitorServerTransport.readSession(SERVER),
      capacitorServerTransport.readSession(SERVER)
    ])

    expect([a, b]).toEqual(['minted-sid', 'minted-sid'])
    expect(httpGet).toHaveBeenCalledTimes(1)
  })

  it('hands the stored session over without a round trip', async () => {
    localStorage.setItem(SESSION_KEY, 'stored-sid')

    expect(await capacitorServerTransport.readSession(SERVER)).toBe('stored-sid')
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('leaves the socket session-less when the server cannot be reached', async () => {
    httpGet.mockRejectedValue(new Error('unreachable'))

    expect(await capacitorServerTransport.readSession(SERVER)).toBeUndefined()
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

  it('replaces a session the server no longer recognizes', async () => {
    // A Set-Cookie is proof Foundry refused the sid we sent — it mints only for
    // a request that carried none — so a server that restarted (dropping its
    // session table) must not leave us re-presenting the dead one forever.
    localStorage.setItem(SESSION_KEY, 'dead-sid')
    httpGet.mockResolvedValue(withSession('live-sid'))

    await capacitorServerTransport.getJoinData(SERVER, socketSilence)

    expect(localStorage.getItem(SESSION_KEY)).toBe('live-sid')
    expect(httpGet).toHaveBeenCalledTimes(1)
  })

  it('keeps a session the server accepted', async () => {
    localStorage.setItem(SESSION_KEY, 'live-sid')
    httpGet.mockResolvedValue(withoutSession())

    await capacitorServerTransport.getJoinData(SERVER, socketSilence)

    // No Set-Cookie means Foundry took ours; a transient socket failure must
    // not cost a session that works.
    expect(localStorage.getItem(SESSION_KEY)).toBe('live-sid')
    expect(deleteCookie).not.toHaveBeenCalled()
  })

  it('asks only once when the join page mints a session', async () => {
    httpGet.mockResolvedValue(withSession('join-sid'))

    await capacitorServerTransport.getJoinData(SERVER, socketSilence)

    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(deleteCookie).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_KEY)).toBe('join-sid')
  })
})
