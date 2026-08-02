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
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ userId: ref('me'), getUserId: () => 'me' })
}))

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
    localStorage.setItem('proxy-id', 'display')
    const store = useTargetHelperStore()
    store.start()
    expect(store.targetingProxyId).toBeUndefined()
    expect(requestTargets).not.toHaveBeenCalled()

    setWorld([{ _id: 'display', name: 'Table TV' }])
    await nextTick()

    expect(store.targetingProxyId).toBe('display')
    expect(requestTargets).toHaveBeenCalledWith('display')
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
