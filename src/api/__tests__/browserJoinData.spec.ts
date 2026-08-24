// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { browserServerTransport } from '@/api/browserServerTransport'
import type { JoinData } from '@/api/serverTransport'

// Foundry v14 wires a socket's event listeners only when the handshake's Cookie
// header names a session it recognizes; without one, getJoinData is answered
// with silence rather than an error. The browser build's only way out is to mint
// a session over HTTP and let the next socket carry it, so that fallback is
// pinned here — it's the difference between a login page and a permanent
// "Loading users…".

const SERVER = new URL('https://vtt.example.com/')
const POPULATED: JoinData = {
  users: [{ _id: 'u1', name: 'Alice', role: 1, color: '#fff' }],
  activeUsers: [],
  userId: null
}
const EMPTY: JoinData = { users: [], activeUsers: [], userId: null }

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browserServerTransport.getJoinData', () => {
  it('returns the socket’s answer and touches nothing else', async () => {
    const data = await browserServerTransport.getJoinData(SERVER, () => Promise.resolve(POPULATED))

    expect(data).toEqual(POPULATED)
    // GET /join signs the session out of the world, so a working socket must
    // never be followed by one.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mints a session when the socket answers with no users', async () => {
    const data = await browserServerTransport.getJoinData(SERVER, () => Promise.resolve(EMPTY))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://vtt.example.com/join')
    // Empty, not a throw: the login page reads that as "get a fresh socket and
    // try again", which is exactly what the new session needs.
    expect(data).toEqual(EMPTY)
  })

  it('mints a session when the socket never answers', async () => {
    const data = await browserServerTransport.getJoinData(SERVER, () =>
      Promise.reject(new Error('getJoinData timed out'))
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(data).toEqual(EMPTY)
  })

  it('still reports an empty list when minting itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    await expect(
      browserServerTransport.getJoinData(SERVER, () => Promise.resolve(EMPTY))
    ).resolves.toEqual(EMPTY)
  })
})
