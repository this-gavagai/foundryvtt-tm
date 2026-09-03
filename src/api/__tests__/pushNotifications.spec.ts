// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Relay registrations are per (world, user), so "have we registered?" is a
// question about the whole (server, user, device) identity. Keying it on the
// device token alone — which never changes — meant a server switch or a
// re-login silently never registered, and the new world could not push at all
// until the app was killed and relaunched. These tests pin that.

const listeners = new Map<string, (arg: unknown) => void>()
const registerPush = vi.fn()
const recordPushRegistration = vi.fn()
const requestFocusMessage = vi.fn()
const selectServer = vi.fn()
const permission = { receive: 'granted' }

let currentOrigin: string | undefined = 'https://alpha.example'
let currentUserId: string | undefined = 'alice'
let savedServers: string[] = ['https://alpha.example']

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' }
}))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: async (event: string, handler: (arg: unknown) => void) =>
      void listeners.set(event, handler),
    requestPermissions: async () => permission,
    register: async () => {}
  }
}))

vi.mock('@/api/actionRpc', () => ({ registerPush: () => registerPush() }))
vi.mock('@/api/pushRegistry', () => ({
  recordPushRegistration: (...args: unknown[]) => recordPushRegistration(...args)
}))
vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    requestFocusMessage: (...args: unknown[]) => requestFocusMessage(...args)
  })
}))
vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({
    serverUrl: currentOrigin ? new URL(currentOrigin) : undefined,
    servers: savedServers,
    selectServer: (...args: unknown[]) => selectServer(...args)
  })
}))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ getUserId: () => currentUserId }) }))

let fetchMock: ReturnType<typeof vi.fn>
// The module wires a document listener; capture it rather than dispatching for
// real, since jsdom's document outlives each test's module instance and stale
// handlers would fire alongside the current one.
const docListeners = new Map<string, () => void>()

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
  savedServers = ['https://alpha.example', 'https://beta.example']
  registerPush.mockResolvedValue({ regToken: 'reg.tok', relayUrl: 'https://relay.example' })
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true, worldId: 'world-1', userId: 'alice' }), {
        status: 200
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  docListeners.clear()
  vi.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
    docListeners.set(String(event), handler as () => void)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

    await vi.waitFor(() =>
      expect(registerBodies().some((b) => b.serverBaseUrl === 'https://beta.example')).toBe(true)
    )
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

describe('notification tap routing', () => {
  // A notification belongs to one world reached at one address, and the app may
  // be pointed somewhere else by the time it is tapped — a message id from
  // another world means nothing where it lands.
  function tap(data: Record<string, string>) {
    listeners.get('pushNotificationActionPerformed')!({ notification: { data } })
  }

  it('focuses the message when the push came from the active server', async () => {
    await bootWithToken()
    tap({ tmMessageId: 'msg1', tmServerBaseUrl: 'https://alpha.example' })
    expect(selectServer).not.toHaveBeenCalled()
    expect(requestFocusMessage).toHaveBeenCalledWith('msg1')
  })

  it('switches to the server the push came from first', async () => {
    await bootWithToken()
    tap({ tmMessageId: 'msg1', tmServerBaseUrl: 'https://beta.example' })
    expect(selectServer).toHaveBeenCalledWith('https://beta.example')
    expect(requestFocusMessage).toHaveBeenCalledWith('msg1')
  })

  it('compares origins rather than raw strings', async () => {
    await bootWithToken()
    // Same origin, trailing path: not a different server.
    tap({ tmMessageId: 'msg1', tmServerBaseUrl: 'https://alpha.example/' })
    expect(selectServer).not.toHaveBeenCalled()
    expect(requestFocusMessage).toHaveBeenCalledWith('msg1')
  })

  it('does not focus a message from a server this device no longer has saved', async () => {
    await bootWithToken()
    savedServers = ['https://alpha.example']
    tap({ tmMessageId: 'msg1', tmServerBaseUrl: 'https://gone.example' })
    // Focusing would highlight a foreign id in whatever world is open.
    expect(selectServer).not.toHaveBeenCalled()
    expect(requestFocusMessage).not.toHaveBeenCalled()
  })

  it('focuses without switching when the payload names no server (older relay)', async () => {
    await bootWithToken()
    tap({ tmMessageId: 'msg1' })
    expect(selectServer).not.toHaveBeenCalled()
    expect(requestFocusMessage).toHaveBeenCalledWith('msg1')
  })

  it('ignores a payload with no message id', async () => {
    await bootWithToken()
    tap({ tmServerBaseUrl: 'https://beta.example' })
    expect(requestFocusMessage).not.toHaveBeenCalled()
    expect(selectServer).not.toHaveBeenCalled()
  })
})

describe('foreground heartbeat', () => {
  // The relay prunes registrations untouched for 30 days, and re-registration
  // otherwise only happens when the identity changes — which on a long-lived app
  // process may be never.
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    docListeners.get('visibilitychange')?.()
  }

  // Move the clock past the throttle without touching timers, which vi.waitFor
  // and the module's own awaits depend on. An hour, so this stays correct if
  // HEARTBEAT_MIN_INTERVAL_MS is tuned again — the tests below care that the
  // throttle exists, not what it is set to.
  function advancePastThrottle() {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 60 * 60 * 1000)
  }

  it('re-registers on foreground even though nothing changed', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))

    advancePastThrottle()
    setVisibility('visible')
    await vi.waitFor(() => expect(registerBodies().length).toBe(2))
  })

  it('throttles rapid foregrounds, because each register costs relay writes', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))

    setVisibility('visible')
    setVisibility('visible')
    await new Promise((r) => setTimeout(r, 0))
    expect(registerBodies().length).toBe(1)
  })

  it('does nothing on going to the background', async () => {
    const mod = await bootWithToken()
    mod.syncPushRegistration()
    await vi.waitFor(() => expect(registerBodies().length).toBe(1))

    advancePastThrottle()
    setVisibility('hidden')
    await new Promise((r) => setTimeout(r, 0))
    expect(registerBodies().length).toBe(1)
  })
})
