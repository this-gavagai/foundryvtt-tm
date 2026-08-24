// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Socket } from 'socket.io-client'
import type { JoinAttempt } from '@/api/serverTransport'

// The point of storing a password is that a dead session stops being a dead
// end: the app mints a new one itself instead of routing the user to the login
// page. These tests pin the routing decisions that make that safe — above all
// which failures are allowed to discard a saved password.

const SERVER = new URL('https://vtt.example.com/')

const verifyCredentials = vi.fn<(...args: unknown[]) => Promise<JoinAttempt>>()
const deleteSession = vi.fn()
const readCredential = vi.fn()
const writeCredential = vi.fn()
const forgetCredential = vi.fn()
const establishSocket = vi.fn()
const dropLoadedCharacterData = vi.fn()
const clearCachedCharacterData = vi.fn()

// Every socket the store creates, with its handlers captured so a test can
// play the server's side of the handshake.
type FakeSocket = Socket & { fire: (event: string, ...args: unknown[]) => void }
const sockets: FakeSocket[] = []

function makeSocket(): FakeSocket {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const socket = {
    id: `socket-${sockets.length}`,
    connected: true,
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return socket
    },
    onAny: () => socket,
    onAnyOutgoing: () => socket,
    off: () => socket,
    once: () => socket,
    emit: () => socket,
    removeAllListeners: () => socket,
    disconnect: () => socket,
    fire(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args)
    }
  } as unknown as FakeSocket
  return socket
}

vi.mock('@/api/socketConnection', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/socketConnection')>('@/api/socketConnection')
  return {
    ...actual,
    establishSocket: (...args: unknown[]) => establishSocket(...args),
    getServerTransport: () => ({
      readSession: () => undefined,
      deleteSession: (...args: unknown[]) => deleteSession(...args),
      getJoinData: async () => ({ users: [], activeUsers: [], userId: null }),
      verifyCredentials: (...args: unknown[]) => verifyCredentials(...args),
      probe: async () => true,
      sessionIsAuthenticated: async () => undefined
    })
  }
})

vi.mock('@/api/credentialStore', () => ({
  readCredential: (...args: unknown[]) => readCredential(...args),
  writeCredential: (...args: unknown[]) => writeCredential(...args),
  forgetCredential: (...args: unknown[]) => forgetCredential(...args)
}))

// The address store's real module drags in the whole world/cache graph; the
// server store only ever asks it for the active URL, the platform, and (on
// sign-out) to drop the loaded server's in-memory character data.
vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({
    serverUrl: SERVER,
    isNativeMobile: true,
    dropLoadedCharacterData: () => dropLoadedCharacterData()
  }),
  serverUrlCandidates: () => [SERVER]
}))

vi.mock('@/utils/cachedCharacterData', () => ({
  clearCachedCharacterData: (...args: unknown[]) => clearCachedCharacterData(...args)
}))

async function loadStore() {
  const { useServerStore } = await import('@/stores/server')
  return useServerStore()
}

// Let the store's promise chains (reauth → reconnect → handlers) settle.
async function settle(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve()
}

// Bring up a connected socket and have Foundry report the session as anonymous
// — the state that used to mean "show the login page", unconditionally.
async function connectAndGoAnonymous() {
  const store = await loadStore()
  await store.connectToServer(SERVER)
  await settle()
  sockets.at(-1)!.fire('session', {})
  await settle()
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  sockets.length = 0
  vi.clearAllMocks()
  localStorage.clear()
  deleteSession.mockResolvedValue(undefined)
  clearCachedCharacterData.mockResolvedValue(undefined)
  writeCredential.mockResolvedValue(undefined)
  forgetCredential.mockResolvedValue(undefined)
  readCredential.mockResolvedValue(undefined)
  establishSocket.mockImplementation(
    async (_url: URL, _t: unknown, _k: boolean, onCreated: (s: Socket) => void) => {
      const socket = makeSocket()
      sockets.push(socket)
      onCreated(socket)
      return socket
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('silent re-authentication', () => {
  it('shows the login page when no password is saved', async () => {
    const store = await connectAndGoAnonymous()
    expect(verifyCredentials).not.toHaveBeenCalled()
    expect(store.needsLogin).toBe(true)
  })

  // The whole point: a session that died on its own is repaired behind the
  // cached sheet, and needsLogin never flips.
  it('re-authenticates and reconnects without showing the login page', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    verifyCredentials.mockResolvedValue('ok')

    const store = await connectAndGoAnonymous()

    expect(verifyCredentials).toHaveBeenCalledWith(SERVER, 'user-1', 'hunter2')
    expect(store.needsLogin).toBe(false)
    // A fresh socket, because the old one is bound to the anonymous session.
    expect(sockets.length).toBeGreaterThan(1)
    expect(forgetCredential).not.toHaveBeenCalled()
  })

  // Foundry named a terminal credential error, so the saved password can never
  // work again. Keeping it would loop silently forever, out of the user's view.
  it('discards the password and shows the login page when Foundry rejects it', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'stale' })
    verifyCredentials.mockResolvedValue('rejected')

    const store = await connectAndGoAnonymous()

    expect(forgetCredential).toHaveBeenCalledWith(SERVER.origin)
    expect(store.needsLogin).toBe(true)
  })

  // The asymmetry that decides whether this feature is pleasant or maddening:
  // an outage or a half-booted world must cost the user nothing permanent.
  it('keeps the password when the server could not answer', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    verifyCredentials.mockResolvedValue('unavailable')

    const store = await connectAndGoAnonymous()

    expect(forgetCredential).not.toHaveBeenCalled()
    expect(store.needsLogin).toBe(true)
  })

  // A transient failure must not burn the retry budget, or a flaky evening
  // would permanently exhaust it and force a manual login.
  it('spends no budget on an unavailable server', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    verifyCredentials.mockResolvedValue('unavailable')
    await connectAndGoAnonymous()

    for (let i = 0; i < 4; i++) {
      sockets.at(-1)!.fire('session', {})
      await settle()
    }

    // Still trying on the fifth round: only a login that succeeds and *still*
    // leaves the socket anonymous counts against the ceiling, so an outage
    // can't quietly use up the user's ability to self-repair.
    expect(verifyCredentials).toHaveBeenCalledTimes(5)
    expect(forgetCredential).not.toHaveBeenCalled()
  })

  // A login that keeps succeeding while the socket stays anonymous is
  // structurally broken; without a ceiling the app would loop forever.
  it('gives up on the login page after repeated useless re-auths', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    verifyCredentials.mockResolvedValue('ok')

    const store = await loadStore()
    await store.connectToServer(SERVER)
    await settle()
    for (let i = 0; i < 5; i++) {
      sockets.at(-1)!.fire('session', {})
      await settle()
    }
    expect(store.needsLogin).toBe(true)
  })

  // A good handshake means the session works, so an earlier repair spend
  // shouldn't count against a future one.
  it('restores the budget after a successful handshake', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    verifyCredentials.mockResolvedValue('ok')

    const store = await loadStore()
    await store.connectToServer(SERVER)
    await settle()
    for (let i = 0; i < 5; i++) {
      sockets.at(-1)!.fire('session', {})
      await settle()
    }
    expect(store.needsLogin).toBe(true)

    sockets.at(-1)!.fire('session', { userId: 'user-1' })
    await settle()
    expect(store.needsLogin).toBe(false)

    sockets.at(-1)!.fire('session', {})
    await settle()
    expect(store.needsLogin).toBe(false)
  })

  // Two triggers can land on the same dead session (the session event and the
  // handshake watchdog); they must share one login, not race two.
  it('deduplicates concurrent repair attempts', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    let release: (v: JoinAttempt) => void = () => {}
    verifyCredentials.mockReturnValue(
      new Promise<JoinAttempt>((resolve) => {
        release = resolve
      })
    )

    const store = await loadStore()
    await store.connectToServer(SERVER)
    await settle()
    const socket = sockets.at(-1)!
    socket.fire('session', {})
    socket.fire('session', {})
    await settle()

    expect(verifyCredentials).toHaveBeenCalledTimes(1)
    release('ok')
    await settle()
    expect(store.needsLogin).toBe(false)
  })
})

describe('login', () => {
  it('saves the password for later repairs', async () => {
    verifyCredentials.mockResolvedValue('ok')
    const store = await loadStore()

    await expect(store.login('user-1', 'hunter2', 'Alice')).resolves.toBe('ok')
    expect(writeCredential).toHaveBeenCalledWith(SERVER.origin, 'user-1', 'hunter2')
  })

  it('saves nothing when the credentials are refused', async () => {
    verifyCredentials.mockResolvedValue('rejected')
    const store = await loadStore()

    await expect(store.login('user-1', 'wrong')).resolves.toBe('rejected')
    expect(writeCredential).not.toHaveBeenCalled()
  })

  // The login page needs the difference: `rejected` is the only outcome where
  // "check your credentials" is true, and a server that couldn't take the
  // request at all must not be reported as a bad password.
  it('reports a server that could not take the request as unavailable', async () => {
    verifyCredentials.mockResolvedValue('unavailable')
    const store = await loadStore()

    await expect(store.login('user-1', 'hunter2')).resolves.toBe('unavailable')
    expect(writeCredential).not.toHaveBeenCalled()
  })
})

describe('signOut', () => {
  // Silent re-auth makes the login page otherwise unreachable, so this is the
  // only way to switch Foundry users. Dropping the session matters as much as
  // dropping the password: a still-valid session would sign the user straight
  // back in on the next socket.
  it('drops both the saved password and the live session', async () => {
    readCredential.mockResolvedValue({ userid: 'user-1', password: 'hunter2' })
    verifyCredentials.mockResolvedValue('ok')

    const store = await loadStore()
    await store.connectToServer(SERVER)
    await settle()
    sockets.at(-1)!.fire('session', { userId: 'user-1' })
    await settle()
    expect(store.needsLogin).toBe(false)

    readCredential.mockResolvedValue(undefined)
    await store.signOut()
    await settle()

    expect(forgetCredential).toHaveBeenCalledWith(SERVER.origin)
    expect(deleteSession).toHaveBeenCalledWith(SERVER)
    expect(store.needsLogin).toBe(true)
  })

  // Someone else signs in on this device next, so the previous user's sheets
  // and chat must not be sitting in the cache waiting for them.
  it('deletes the server’s cached character data', async () => {
    const store = await loadStore()
    await store.connectToServer(SERVER)
    await settle()
    sockets.at(-1)!.fire('session', { userId: 'user-1' })
    await settle()

    await store.signOut()
    await settle()

    expect(clearCachedCharacterData).toHaveBeenCalledWith(SERVER.origin)
  })

  // Ordering, not just occurrence: the debounced snapshot/chat writers are
  // cancelled by the in-memory drop, so a purge that ran first could have a
  // trailing write land behind it and re-create what it just deleted.
  it('drops the in-memory character data before purging the caches', async () => {
    const order: string[] = []
    dropLoadedCharacterData.mockImplementation(() => order.push('drop'))
    clearCachedCharacterData.mockImplementation(() => {
      order.push('purge')
      return Promise.resolve()
    })

    const store = await loadStore()
    await store.connectToServer(SERVER)
    await settle()
    sockets.at(-1)!.fire('session', { userId: 'user-1' })
    await settle()

    await store.signOut()
    await settle()

    expect(order).toEqual(['drop', 'purge'])
  })
})
