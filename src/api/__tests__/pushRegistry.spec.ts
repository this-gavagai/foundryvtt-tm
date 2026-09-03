// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { recordPushRegistration, forgetPushRegistration } from '@/api/pushRegistry'

// The registry is the app's only memory of what it registered with the relay
// (the world id is minted Foundry-side and never derivable locally), so what
// matters here is that a record survives to be undone later and that undoing it
// actually reaches /unregister.

const STORAGE_KEY = 'tablemate.pushRegistrations'
const RELAY = 'https://relay.example'
const ORIGIN = 'https://vtt.example.com'

const record = (over: Partial<{ worldId: string; userId: string; deviceToken: string }> = {}) => ({
  relayUrl: RELAY,
  worldId: 'world-1',
  userId: 'alice',
  deviceToken: 'devtokenA',
  ...over
})

let fetchMock: ReturnType<typeof vi.fn>

// Unregister is fire-and-forget, so the assertions have to let its promise settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function unregisterBodies() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/unregister'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('recordPushRegistration', () => {
  it('persists the relay-assigned identity per origin', () => {
    recordPushRegistration(ORIGIN, record())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ [ORIGIN]: record() })
  })

  it('keeps origins independent', () => {
    recordPushRegistration(ORIGIN, record())
    recordPushRegistration('https://other.example', record({ worldId: 'world-2' }))
    expect(Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEY)!))).toEqual([
      ORIGIN,
      'https://other.example'
    ])
  })

  it('re-registering the same identity does not unregister anything', async () => {
    recordPushRegistration(ORIGIN, record())
    recordPushRegistration(ORIGIN, record())
    await flush()
    expect(unregisterBodies()).toEqual([])
  })

  it('unregisters the superseded identity when the user changes on one server', async () => {
    recordPushRegistration(ORIGIN, record())
    recordPushRegistration(ORIGIN, record({ userId: 'bob' }))
    await flush()
    // Alice's registration would otherwise keep pushing her chat to this device
    // for 30 days after someone else logged in on it.
    expect(unregisterBodies()).toEqual([
      { worldId: 'world-1', userId: 'alice', deviceToken: 'devtokenA' }
    ])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[ORIGIN].userId).toBe('bob')
  })

  it('unregisters the old device token when APNs rotates it', async () => {
    recordPushRegistration(ORIGIN, record())
    recordPushRegistration(ORIGIN, record({ deviceToken: 'devtokenB' }))
    await flush()
    expect(unregisterBodies()[0].deviceToken).toBe('devtokenA')
  })
})

describe('forgetPushRegistration', () => {
  it('posts to the recorded relay and drops the record', async () => {
    recordPushRegistration(ORIGIN, record())
    forgetPushRegistration(ORIGIN)
    await flush()

    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/unregister'))!
    expect(url).toBe(`${RELAY}/unregister`)
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      worldId: 'world-1',
      userId: 'alice',
      deviceToken: 'devtokenA'
    })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[ORIGIN]).toBeUndefined()
  })

  it('is a no-op for an origin that never registered', async () => {
    forgetPushRegistration('https://never.example')
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops the record even when the relay is unreachable', async () => {
    // The relay prunes stale registrations anyway, so a failed unregister must
    // not leave a record that keeps trying forever.
    fetchMock.mockRejectedValue(new Error('offline'))
    recordPushRegistration(ORIGIN, record())
    forgetPushRegistration(ORIGIN)
    await flush()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[ORIGIN]).toBeUndefined()
  })

  it('keeps the relay entry when another origin still shares it', async () => {
    // The same world saved twice — LAN and remote address — is one relay entry.
    recordPushRegistration('http://192.168.1.5:30000', record())
    recordPushRegistration('https://foundry.example.com', record())

    forgetPushRegistration('http://192.168.1.5:30000')
    await flush()
    expect(unregisterBodies()).toEqual([])

    // Once the last holder goes, so does the registration.
    forgetPushRegistration('https://foundry.example.com')
    await flush()
    expect(unregisterBodies().length).toBe(1)
  })

  it('does not unregister a superseded record another origin still shares', async () => {
    recordPushRegistration('http://192.168.1.5:30000', record())
    recordPushRegistration('https://foundry.example.com', record())
    // Re-logging as bob on one address must not cut alice off on the other.
    recordPushRegistration('http://192.168.1.5:30000', record({ userId: 'bob' }))
    await flush()
    expect(unregisterBodies()).toEqual([])
  })

  it('survives a corrupt store instead of throwing', async () => {
    localStorage.setItem(STORAGE_KEY, 'not json')
    expect(() => forgetPushRegistration(ORIGIN)).not.toThrow()
    recordPushRegistration(ORIGIN, record())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[ORIGIN]).toEqual(record())
  })
})
