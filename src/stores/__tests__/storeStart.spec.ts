// @vitest-environment jsdom
// listenersOnline.start() registers a visibilitychange listener, so it needs a DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { registerStoreBridge, resetStoreBridgeForTest } from '@/api/storeBridge'
import { fakeStoreBridge } from '@/api/__tests__/socketMock'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { useListenersStore } from '@/stores/listenersOnline'

// These stores used to run their side effects (an 8s status poll, a 30s
// presence heartbeat + immediate socket ping) in the store setup body, so
// merely instantiating one — which any store unit test must do — spawned
// intervals and network work and made the store untestable. Moving those into
// an explicit, idempotent start() is what lets these tests exist: they
// instantiate the stores, prove nothing fired, and exercise the pure state.

beforeEach(() => {
  setActivePinia(createPinia())
  // listenersOnline's start() pings through the api layer; register a fake
  // bridge so that path has something to call (it still only runs on start()).
  registerStoreBridge(fakeStoreBridge())
  vi.useFakeTimers()
})
afterEach(() => {
  resetStoreBridgeForTest()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('foundryWorldStatus', () => {
  it('instantiating the store spawns no poll interval', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    useFoundryWorldStatusStore()
    expect(setInterval).not.toHaveBeenCalled()
  })

  it('start() spawns the poll exactly once (idempotent)', () => {
    const store = useFoundryWorldStatusStore()
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    store.start()
    store.start()
    expect(setInterval).toHaveBeenCalledTimes(1)
  })

  it('exposes the world-status transitions with no I/O', () => {
    const store = useFoundryWorldStatusStore()
    expect(store.worldLoaded).toBeUndefined()
    expect(store.worldAuthenticated).toBeUndefined()

    store.markWorldLoaded()
    expect(store.worldLoaded).toBe(true)

    store.setWorldAuthenticated(true)
    expect(store.worldAuthenticated).toBe(true)

    store.markWorldInactive()
    expect(store.worldLoaded).toBe(false)
    expect(store.worldAuthenticated).toBe(false)

    store.markWorldPending()
    expect(store.worldLoaded).toBeUndefined()
    expect(store.worldAuthenticated).toBeUndefined()
  })
})

describe('listenersOnline', () => {
  it('instantiating the store spawns no heartbeat interval', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    useListenersStore()
    expect(setInterval).not.toHaveBeenCalled()
  })

  it('addListener drives isListening, with no network on instantiation', () => {
    const store = useListenersStore()
    expect(store.isListening).toBe(false)

    store.addListener('gm-1')
    expect(store.isListening).toBe(true)
    expect(store.listenersOnline.has('gm-1')).toBe(true)
  })

  it('drops every known listener on reset (server/user switch)', () => {
    // Carried over, the new world inherits the old world's GM: roll buttons
    // live against a client that cannot answer anything here.
    const store = useListenersStore()
    store.addListener('gm-1')

    store.reset()
    expect(store.isListening).toBe(false)
  })

  it('expires a listener that stopped announcing, even with no connection', async () => {
    // The prune used to be sequenced after the socket emit, so it never ran
    // while the app was offline — isListening stayed true for the whole outage.
    const store = useListenersStore()
    store.addListener('gm-1')
    expect(store.isListening).toBe(true)

    // Well past the 45s TTL. The ping's own socket lookup is irrelevant here —
    // that is the point: the prune must not be waiting behind it.
    vi.setSystemTime(Date.now() + 60_000)
    store.ping()
    await vi.advanceTimersByTimeAsync(0)

    expect(store.isListening).toBe(false)
  })

  it('start() spawns the heartbeat exactly once (idempotent)', () => {
    const store = useListenersStore()
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    store.start()
    store.start()
    expect(setInterval).toHaveBeenCalledTimes(1)
  })
})
