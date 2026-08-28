// @vitest-environment jsdom
// The proxy id is persisted with useStorage, so the store needs localStorage.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, shallowRef } from 'vue'

// The store asks the proxy's client for a fresh report whenever the proxy
// changes; capture that instead of reaching the socket.
const requestTargets = vi.fn((_proxyId: string) => Promise.resolve())
vi.mock('@/api/actionRpc', () => ({ requestTargets: (id: string) => requestTargets(id) }))
vi.mock('@/api/documents', () => ({ updateUserTargetingProxy: vi.fn(() => Promise.resolve(null)) }))
vi.mock('@/utils/utilities', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

// Minimal world/user stores: the target helper only reads the user list (to
// decide whether a proxy id is selectable) and the signed-in user's id.
const world = shallowRef<{ users: Array<Record<string, unknown>> } | undefined>(undefined)
const usersById = ref(new Map<string, Record<string, unknown>>())
vi.mock('@/stores/world', () => ({
  useWorldStore: () => ({
    world,
    usersById,
    userById: (id: string | null | undefined) => (id ? usersById.value.get(id) : undefined)
  })
}))
const userId = ref('me')
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userId, getUserId: () => userId.value })
}))
// The local proxy choice is scoped per (server, user), so the store needs both.
const serverUrl = ref<URL | undefined>(new URL('https://table.example'))
vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({ serverUrl })
}))

// Same shape the store persists: one entry per `${origin}|${userId}` pairing.
function seedLocalChoice(scope: string, proxyId: string) {
  localStorage.setItem('proxy-id-by-scope', JSON.stringify({ [scope]: proxyId }))
}

import { useTargetHelperStore } from '@/stores/targetHelper'

function setWorld(users: Array<{ _id: string; name: string; root?: boolean }>) {
  const docs = users.map((u) => ({
    _id: u._id,
    name: u.name,
    flags: u.root ? { tablemate: { character_sheet: 'root' } } : {}
  }))
  usersById.value = new Map(docs.map((d) => [d._id as string, d]))
  world.value = { users: docs }
}

const someTargets = { sceneId: 'scene-a', tokenIds: ['tok-1'] }

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  requestTargets.mockClear()
  world.value = undefined
  usersById.value = new Map()
  userId.value = 'me'
  serverUrl.value = new URL('https://table.example')
})
afterEach(() => vi.restoreAllMocks())

describe('mirroring', () => {
  it('accepts a report only from the configured proxy', async () => {
    setWorld([
      { _id: 'display', name: 'Table TV' },
      { _id: 'other', name: 'Someone Else' }
    ])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')

    store.updateTargets('other', someTargets)
    expect(store.getTargets().tokenIds).toEqual([])

    store.updateTargets('display', someTargets)
    expect(store.getTargets()).toEqual(someTargets)
  })

  it('keeps the scene together with the ids it belongs to', async () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')

    store.updateTargets('display', { sceneId: 'scene-b', tokenIds: ['tok-9'] })
    expect(store.getTargets()).toEqual({ sceneId: 'scene-b', tokenIds: ['tok-9'] })
  })

  it('ignores a root (sheet) user as a proxy — those clients have no canvas', async () => {
    setWorld([{ _id: 'sheet', name: 'Bob Sheet', root: true }])
    const store = useTargetHelperStore()
    await store.updateProxyId('sheet')
    expect(store.targetingProxyId).toBeUndefined()

    store.updateTargets('sheet', someTargets)
    expect(store.getTargets().tokenIds).toEqual([])
  })
})

// A tablet is a shared, travelling device: it gets handed to another player and
// it gets pointed at another server. Its local proxy choice belongs to exactly
// one (server, user) pairing.
describe('local choice scoping', () => {
  const world = [
    { _id: 'display', name: 'Table TV' },
    { _id: 'laptop', name: 'My Laptop' }
  ]

  it('does not hand one user the proxy the previous user picked on this device', () => {
    seedLocalChoice('https://table.example|someone-else', 'display')
    setWorld(world)
    expect(useTargetHelperStore().targetingProxyId).toBeUndefined()
  })

  it('does not carry a choice to another server', () => {
    seedLocalChoice('https://other.example|me', 'display')
    setWorld(world)
    expect(useTargetHelperStore().targetingProxyId).toBeUndefined()
  })

  it('applies the choice made for this server and user', () => {
    seedLocalChoice('https://table.example|me', 'display')
    setWorld(world)
    expect(useTargetHelperStore().targetingProxyId).toBe('display')
  })

  it('falls back to the stored flag where this device has no choice', () => {
    setWorld(world)
    usersById.value.set('me', { _id: 'me', flags: { tablemate: { targeting_proxy: 'laptop' } } })
    expect(useTargetHelperStore().targetingProxyId).toBe('laptop')
  })

  it('honours an explicit local "none" over the stored flag', async () => {
    // Clearing must stick even when the flag write fails: the device's own
    // "none" is a choice, not the absence of one.
    setWorld(world)
    usersById.value.set('me', { _id: 'me', flags: { tablemate: { targeting_proxy: 'laptop' } } })
    const store = useTargetHelperStore()
    expect(store.targetingProxyId).toBe('laptop')

    await store.updateProxyId('')
    expect(store.targetingProxyId).toBeUndefined()
  })
})

describe('staleness', () => {
  it('drops targets when the proxy changes', async () => {
    setWorld([
      { _id: 'display', name: 'Table TV' },
      { _id: 'laptop', name: 'My Laptop' }
    ])
    const store = useTargetHelperStore()
    store.start()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)
    expect(store.getTargets().tokenIds).toEqual(['tok-1'])

    await store.updateProxyId('laptop')
    await nextTick()
    // Inheriting the old proxy's selection would aim the next roll at whatever
    // the previous display happened to be pointing at.
    expect(store.getTargets().tokenIds).toEqual([])
  })

  it('drops targets when the proxy goes offline', async () => {
    // Nothing is broadcast when a client disconnects, so the last report we hold
    // would keep aiming rolls at a selection no one at the table can see.
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)

    store.reportUserActivity('display', false)
    expect(store.getTargets().tokenIds).toEqual([])
  })

  it('flags a proxy whose client has gone, and clears the flag on its return', async () => {
    // Otherwise an offline proxy is a silent dead end: it answers no report
    // request, so rolls quietly go out untargeted with its name still in the
    // picker.
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    // Not yet heard from — "unknown" must not render as offline.
    expect(store.proxyOffline).toBe(false)

    store.reportUserActivity('display', false)
    expect(store.proxyOffline).toBe(true)

    store.reportUserActivity('display', true)
    expect(store.proxyOffline).toBe(false)
  })

  it('re-asks when the proxy comes back online', async () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    requestTargets.mockClear()

    store.reportUserActivity('display', true)
    expect(requestTargets).toHaveBeenCalledWith('display')
  })

  it('ignores presence for anyone who is not the proxy', async () => {
    setWorld([
      { _id: 'display', name: 'Table TV' },
      { _id: 'other', name: 'Someone Else' }
    ])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)

    store.reportUserActivity('other', false)
    expect(store.getTargets()).toEqual(someTargets)
  })

  it('ignores ordinary activity broadcasts, which carry no presence flag', async () => {
    // Cursor moves and ruler drags arrive on the same event with no `active`.
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)

    store.reportUserActivity('display', undefined)
    expect(store.getTargets()).toEqual(someTargets)
  })

  it('drops targets on reset (server/user switch)', async () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)

    store.reset()
    expect(store.getTargets()).toEqual({ sceneId: null, tokenIds: [] })
  })
})

describe('bootstrap', () => {
  it('does not ask anyone before the world names a proxy', () => {
    const store = useTargetHelperStore()
    store.start()
    expect(requestTargets).not.toHaveBeenCalled()
  })

  it('asks the proxy for its current targeting once the world arrives', async () => {
    // Cold start, faithful ordering: the proxy id is already on disk when the
    // app boots, but stays unusable until the world payload proves that user
    // exists. Any report arriving in that window used to be dropped with no
    // re-request, leaving the tablet untargeted until the proxy next happened
    // to re-target — up to a full heartbeat later, or indefinitely.
    seedLocalChoice('https://table.example|me', 'display')
    const store = useTargetHelperStore()
    store.start()
    expect(store.targetingProxyId).toBeUndefined()
    expect(requestTargets).not.toHaveBeenCalled()

    setWorld([{ _id: 'display', name: 'Table TV' }])
    await nextTick()

    expect(store.targetingProxyId).toBe('display')
    expect(requestTargets).toHaveBeenCalledWith('display')
  })

  it('re-asks when the app returns to the foreground, without dropping what it holds', async () => {
    // A backgrounded tablet stops receiving the proxy's pushes (iOS suspends the
    // socket), so whatever it holds on resume is only as fresh as the moment it
    // went away — and those ids still resolve, so nothing downstream notices.
    //
    // But the proxy has not CHANGED, so what we hold is possibly stale rather
    // than wrong. Clearing it first would leave a roll fired in the gap before
    // the answer lands silently untargeted; a genuinely stale set is caught by
    // the module refusing the roll, which routes back through resync.
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    store.start()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)
    requestTargets.mockClear()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(store.getTargets()).toEqual(someTargets)
    expect(requestTargets).toHaveBeenCalledWith('display')
  })

  it('ignores a visibility change that hides the app', async () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    store.start()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)
    requestTargets.mockClear()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(store.getTargets()).toEqual(someTargets)
    expect(requestTargets).not.toHaveBeenCalled()
  })

  it('resync clears and re-asks, for recovering from a refused roll', async () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)
    requestTargets.mockClear()

    store.resync()
    expect(store.getTargets().tokenIds).toEqual([])
    expect(requestTargets).toHaveBeenCalledWith('display')
  })
})

describe('local choice retention', () => {
  it('keeps the working set of pairings and drops the oldest beyond it', async () => {
    setWorld([
      { _id: 'display', name: 'Table TV' },
      { _id: 'laptop', name: 'My Laptop' }
    ])
    const store = useTargetHelperStore()

    // 14 distinct (server, user) pairings, chosen oldest-first.
    for (let i = 0; i < 14; i++) {
      serverUrl.value = new URL(`https://table-${i}.example`)
      await store.updateProxyId('display')
    }

    const stored = JSON.parse(localStorage.getItem('proxy-id-by-scope') ?? '{}')
    expect(Object.keys(stored)).toHaveLength(12)
    // The two oldest pairings are gone; the most recent survive.
    expect(stored['https://table-0.example|me']).toBeUndefined()
    expect(stored['https://table-1.example|me']).toBeUndefined()
    expect(stored['https://table-13.example|me']).toBe('display')
  })

  it('re-choosing for a pairing keeps it, rather than counting it twice', async () => {
    setWorld([
      { _id: 'display', name: 'Table TV' },
      { _id: 'laptop', name: 'My Laptop' }
    ])
    const store = useTargetHelperStore()

    await store.updateProxyId('display')
    await store.updateProxyId('laptop')

    const stored = JSON.parse(localStorage.getItem('proxy-id-by-scope') ?? '{}')
    expect(stored).toEqual({ 'https://table.example|me': 'laptop' })
  })
})

describe('refresh vs resync', () => {
  it('refresh re-asks and keeps what it holds', async () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    await store.updateProxyId('display')
    store.updateTargets('display', someTargets)
    requestTargets.mockClear()

    store.refresh()
    expect(store.getTargets()).toEqual(someTargets)
    expect(requestTargets).toHaveBeenCalledWith('display')
  })

  it('asks nobody when there is no proxy', () => {
    setWorld([{ _id: 'display', name: 'Table TV' }])
    const store = useTargetHelperStore()
    store.refresh()
    expect(requestTargets).not.toHaveBeenCalled()
  })
})
