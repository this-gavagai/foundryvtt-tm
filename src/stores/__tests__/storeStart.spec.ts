// @vitest-environment jsdom
// listenersOnline.start() registers a visibilitychange listener, so it needs a DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { registerStoreBridge, resetStoreBridgeForTest } from '@/api/storeBridge'
import { fakeStoreBridge } from '@/api/__tests__/socketMock'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Socket } from 'socket.io-client'

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

  // ── Presence we were TOLD about ─────────────────────────────────────────
  //
  // Everything above describes a poll, and a poll's worth of staleness is what
  // a GM signing out used to cost: up to a full TTL of live roll buttons whose
  // taps had nowhere to land. Foundry broadcasts the roster change on
  // `userActivity`, and these cover what the store does with it.

  // A spy socket, so a probe's ANYBODY_HOME can be observed going out.
  function withEmitSpy() {
    const emit = vi.fn()
    registerStoreBridge(fakeStoreBridge({ getSocket: async () => ({ emit }) as unknown as Socket }))
    return emit
  }

  it('drops a departing listener at once, without waiting out its TTL', () => {
    const store = useListenersStore()
    store.addListener('gm-1')

    store.reportUserActivity('gm-1', false)
    expect(store.isListening).toBe(false)
  })

  it('asks again on a departure, so a second GM can answer for the table', async () => {
    const emit = withEmitSpy()
    const store = useListenersStore()
    store.addListener('gm-1')

    store.reportUserActivity('gm-1', false)
    await vi.advanceTimersByTimeAsync(0)
    // Only the elected GM answers ANYBODY_HOME, so this emit IS the candidate
    // check: whoever has just inherited the election answers it.
    expect(emit).toHaveBeenCalledTimes(1)

    store.addListener('gm-2')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(store.isListening).toBe(true)
    expect(store.listenersOnline.has('gm-2')).toBe(true)
  })

  it('prunes whoever ignores the probe, not just the client that left', async () => {
    // Every module client announces once at ready while only the elected GM
    // answers a ping, so the map can hold clients that answer for nothing. A
    // player who logged in half a minute ago used to keep isListening true right
    // through the GM's departure.
    const store = useListenersStore()
    store.addListener('player-1')
    store.addListener('gm-1')
    await vi.advanceTimersByTimeAsync(1_000)

    store.reportUserActivity('gm-1', false)
    expect(store.isListening).toBe(true)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(store.isListening).toBe(false)
  })

  it('leaves an ordinary activity broadcast alone (no presence flag on it)', async () => {
    const emit = withEmitSpy()
    const store = useListenersStore()
    store.addListener('gm-1')

    // Cursor moves and target changes ride the same event with no `active`.
    store.reportUserActivity('gm-1', undefined)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(emit).not.toHaveBeenCalled()
    expect(store.isListening).toBe(true)
  })

  it('probes a client arriving only while it believes nobody is home', async () => {
    const emit = withEmitSpy()
    const store = useListenersStore()
    store.addListener('gm-1')

    // A player joining a table that already has its GM says nothing worth a
    // round trip.
    store.reportUserActivity('player-1', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(emit).not.toHaveBeenCalled()

    // With nobody home the answer can only add: a client whose socket
    // reconnected never re-runs `ready`, so it never re-announces on its own.
    store.reset()
    store.reportUserActivity('gm-1', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
