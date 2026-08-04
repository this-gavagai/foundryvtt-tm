// @vitest-environment jsdom
// The address store reads its saved-server list from localStorage.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Signing out of a server, or forgetting one, must leave none of its character
// data behind — on disk or in memory. These tests pin the parts that are easy
// to get subtly wrong: that the in-memory drop happens *before* the on-disk
// purge (so a debounced writer can't re-create what was deleted), and that
// forgetting a server the user is *not* on leaves the loaded one untouched.

const ACTIVE = 'https://table.example.com'
const OTHER = 'https://other.example.com'

const clearCachedCharacterData = vi.fn((_origin: string) => Promise.resolve())
const cancelPendingSnapshotSaves = vi.fn()

vi.mock('@/utils/cachedCharacterData', () => ({
  clearCachedCharacterData: (origin: string) => clearCachedCharacterData(origin)
}))
vi.mock('@/api/characterSync', () => ({
  cancelPendingSnapshotSaves: () => cancelPendingSnapshotSaves()
}))
// Native mobile is the multi-server platform, so that's where remove/sign-out
// have a saved list to act on.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    convertFileSrc: (src: string) => src
  }
}))
// Leaves of the remove path that reach the network/keystore.
vi.mock('@/api/browserServerTransport', () => ({
  browserServerTransport: { deleteSession: vi.fn() }
}))
vi.mock('@/api/capacitorServerTransport', () => ({
  capacitorServerTransport: { deleteSession: vi.fn() }
}))
vi.mock('@/api/credentialStore', () => ({ forgetCredential: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api/pushRegistry', () => ({ forgetPushRegistration: vi.fn() }))
vi.mock('@/api/actionRpc', () => ({
  rejectAllPending: vi.fn(),
  requestTargets: vi.fn(() => Promise.resolve())
}))
vi.mock('@/api/documents', () => ({ updateUserTargetingProxy: vi.fn(() => Promise.resolve(null)) }))

import { useServerAddressStore } from '@/stores/serverAddress'
import { useWorldStore } from '@/stores/world'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import { useChatStore } from '@/stores/chat'
import { setLastCharacterId } from '@/utils/utilities'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// Enough of a loaded server to tell "dropped" from "still there": a world, a
// selected character, and a cached chat tail.
function loadCharacterData() {
  const world = useWorldStore()
  world.world = { userId: 'user-1', actors: [], messages: [] } as unknown as GamePF2e
  const select = useCharacterSelectStore()
  select.initialize('actor-1')
  const chat = useChatStore()
  chat.cachedMessages = [{ _id: 'msg-1' }] as never
  chat.lastReadTimestamp = 1234
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  localStorage.setItem('tablemate.servers', JSON.stringify([ACTIVE, OTHER]))
  localStorage.setItem('tablemate.serverUrl', ACTIVE)
})

describe('dropLoadedCharacterData', () => {
  it('clears the world, selection and cached chat, and cancels pending writes', () => {
    loadCharacterData()

    useServerAddressStore().dropLoadedCharacterData()

    expect(useWorldStore().world).toBeUndefined()
    expect(useCharacterSelectStore().activeCharacterId).toBe('')
    expect(useChatStore().cachedMessages).toEqual([])
    expect(useChatStore().lastReadTimestamp).toBeNull()
    // The load-bearing half: the debounced snapshot writer captured its origin
    // at queue time, so a trailing save would re-file the deleted snapshot.
    expect(cancelPendingSnapshotSaves).toHaveBeenCalled()
  })
})

describe('removeServer', () => {
  it('drops the loaded data before purging the caches of the active server', () => {
    loadCharacterData()
    const order: string[] = []
    cancelPendingSnapshotSaves.mockImplementation(() => order.push('drop'))
    clearCachedCharacterData.mockImplementation(() => {
      order.push('purge')
      return Promise.resolve()
    })

    useServerAddressStore().removeServer(ACTIVE)

    expect(order).toEqual(['drop', 'purge'])
    expect(clearCachedCharacterData).toHaveBeenCalledWith(ACTIVE)
    expect(useWorldStore().world).toBeUndefined()
  })

  it('purges a non-active server without touching what is loaded', () => {
    loadCharacterData()

    useServerAddressStore().removeServer(OTHER)

    expect(clearCachedCharacterData).toHaveBeenCalledWith(OTHER)
    expect(cancelPendingSnapshotSaves).not.toHaveBeenCalled()
    expect(useWorldStore().world).toBeDefined()
    expect(useCharacterSelectStore().activeCharacterId).toBe('actor-1')
  })
})

describe('character selection', () => {
  // The remembered character is per server, not per user, so it has to go too:
  // otherwise the next person to sign in lands on the previous user's sheet.
  it('reseeds to nothing once the remembered character is gone', () => {
    setLastCharacterId('actor-1')
    const select = useCharacterSelectStore()
    select.initialize('actor-1')

    select.reseedForCurrentServer()
    expect(select.activeCharacterId).toBe('actor-1')

    localStorage.removeItem(`tablemate.lastCharacterId:${ACTIVE}`)
    select.reseedForCurrentServer()
    expect(select.activeCharacterId).toBe('')
  })
})
