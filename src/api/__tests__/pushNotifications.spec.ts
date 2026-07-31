// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Relay registrations are per (world, user), so "have we registered?" is a
// question about the whole (server, user, device) identity. Keying it on the
// device token alone — which never changes — meant a server switch or a
// re-login silently never registered, and the new world could not push at all
// until the app was killed and relaunched. These tests pin that.

const listeners = new Map<string, (arg: unknown) => void>()
const registerPush = vi.fn()
const recordPushRegistration = vi.fn()
const permission = { receive: 'granted' }

let currentOrigin: string | undefined = 'https://alpha.example'
let currentUserId: string | undefined = 'alice'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' }
}))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: async (event: string, handler: (arg: unknown) => void) => void listeners.set(event, handler),
    requestPermissions: async () => permission,
    register: async () => {}
  }
}))

vi.mock('@/api/actionRpc', () => ({ registerPush: () => registerPush() }))
vi.mock('@/api/pushRegistry', () => ({
  recordPushRegistration: (...args: unknown[]) => recordPushRegistration(...args)
}))
vi.mock('@/stores/chat', () => ({ useChatStore: () => ({ requestFocusMessage: vi.fn() }) }))
vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({ serverUrl: currentOrigin ? new URL(currentOrigin) : undefined })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ getUserId: () => currentUserId }) }))

let fetchMock: ReturnType<typeof vi.fn>

async function loadModule() {
  vi.resetModules()
  return import('@/api/pushNotifications')
}

// Bring the module up to "device token in hand, not yet authenticated".
async function bootWithToken(token = 'devtokenA') {
  const mod = await loadModule()
  await mod.initPushNotifications()
  listeners.get('registration')!({ value: token })
  await Promise.resolve()
  return mod
}

function registerBodies() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/register'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

beforeEach(() => {
  listeners.clear()
  vi.clearAllMocks()
  permission.receive = 'granted'
  currentOrigin = 'https://alpha.example'
  currentUserId = 'alice'
  registerPush.mockResolvedValue({ regToken: 'reg.tok', relayUrl: 'https://relay.example' })
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ ok: true, worldId: 'world-1', userId: 'alice' }), { status: 200 })
  )
  vi.stubGlobal('fetch', fetchMock)
})

describe('push registration lifecycle', () => {
  it('waits for both the device token and an authenticated session', async () => {
    const mod = await bootWithToken()
    expect(registerBodies()).toEqual([])

    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))
    expect(registerBodies()[0]).toMatchObject({
      regToken: 'reg.tok',
      deviceToken: 'devtokenA',
      platform: 'ios',
      serverBaseUrl: 'https://alpha.example'
    })
  })

  it('does not re-register on a reconnect to the same server as the same user', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))

    mod.syncPushRegistration()
    mod.syncPushRegistration()
    await new Promise((r) => setTimeout(r, 0))
    expect(registerBodies().length).toBe(1)
  })

  it('registers again after a server switch', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))

    // The gate activates a different server; the new socket authenticates.
    currentOrigin = 'https://beta.example'
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(2))
    expect(registerBodies()[1].serverBaseUrl).toBe('https://beta.example')
  })

  it('registers again after re-logging as a different user on the same server', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))

    currentUserId = 'bob'
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(2))
  })

  it('records the relay-assigned identity against the origin it registered for', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(recordPushRegistration).toHaveBeenCalledTimes(1))
    expect(recordPushRegistration).toHaveBeenCalledWith('https://alpha.example', {
      relayUrl: 'https://relay.example',
      worldId: 'world-1',
      userId: 'alice',
      deviceToken: 'devtokenA'
    })
  })

  it('retries on the next handshake when the relay rejects the registration', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }))
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))
    expect(recordPushRegistration).not.toHaveBeenCalled()

    // Same identity, but nothing was registered — so this must not be skipped.
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(2))
  })

  it('retries when push is not enabled on the world (rejected RPC)', async () => {
    registerPush.mockRejectedValueOnce(new Error('push is not enabled for this world'))
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await new Promise((r) => setTimeout(r, 0))
    expect(registerBodies()).toEqual([])

    registerPush.mockResolvedValue({ regToken: 'reg.tok', relayUrl: 'https://relay.example' })
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))
  })

  it('picks up a switch that landed while a registration was in flight', async () => {
    let release: (v: unknown) => void = () => {}
    registerPush.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await Promise.resolve()

    // Switch servers before the first attempt resolves: the in-flight guard drops
    // this call, so the finally-block re-check is the only thing that saves it.
    currentOrigin = 'https://beta.example'
    mod.syncPushRegistration()
    release({ regToken: 'reg.tok', relayUrl: 'https://relay.example' })

    await vi.waitFor(() => expect(registerBodies().some((b) => b.serverBaseUrl === 'https://beta.example')).toBe(true))
  })

  it('never registers without permission (no device token is issued)', async () => {
    permission.receive = 'denied'
    const mod = await loadModule()
    await mod.initPushNotifications()
    mod.syncPushRegistration()
    await new Promise((r) => setTimeout(r, 0))
    expect(registerBodies()).toEqual([])
  })
})
