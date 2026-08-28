// @vitest-environment jsdom
// The address store reads its saved-server list from localStorage.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Everything the connected world told the app about itself — GM presence, the
// module's capability flags, the manual-roll policy, the token ring art,
// mirrored targets — arrives on a module announcement or a proxy push. None of
// it is re-derived, so a switch to another server has to drop it explicitly.
//
// The reset used to hang off the new server's session handshake, which meant it
// only ran if that server answered. These pin it to the switch itself: picking a
// server that never connects must still leave none of the previous world behind.

const ACTIVE = 'https://table.example.com'
const OTHER = 'https://other.example.com'

vi.mock('@/utils/cachedCharacterData', () => ({
  clearCachedCharacterData: vi.fn(() => Promise.resolve())
}))
vi.mock('@/api/characterSync', () => ({ cancelPendingSnapshotSaves: vi.fn() }))
// Native mobile is the multi-server platform — the only place a switch happens.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    convertFileSrc: (src: string) => src
  }
}))
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
import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useGmPolicyStore } from '@/stores/gmPolicy'
import { useTokenRingStore } from '@/stores/tokenRing'
import { useTargetHelperStore } from '@/stores/targetHelper'

// A world that has announced itself: a GM online, a module of known version and
// capabilities, a manual-roll rule, ring art, and a proxy reporting targets.
function loadWorldScopedState() {
  useListenersStore().addListener('gm-1')
  useVersionCompatStore().reportModule(3, '1.4.0', ['voiceMemo'])
  useGmPolicyStore().reportPolicy('reject')
  useTokenRingStore().reportSpritesheet('modules/themed/rings.json')
  useTargetHelperStore().updateTargets('gm-1', { sceneId: 'scene-1', tokenIds: ['token-1'] })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
})

describe('switching servers', () => {
  it('drops the previous world’s presence and policy without waiting for the new server', () => {
    const address = useServerAddressStore()
    address.selectServer(ACTIVE)
    loadWorldScopedState()

    expect(useListenersStore().isListening).toBe(true)
    expect(useGmPolicyStore().manualRollsBlocked).toBe(true)

    // Switch. Nothing connects — the new server is never reached, so no session
    // handshake ever fires and nothing announces itself.
    address.selectServer(OTHER)

    // GM presence: gates the roll affordances in a dozen-odd components, so
    // carrying it over offers live buttons against a client that isn't there.
    expect(useListenersStore().isListening).toBe(false)
    // Capability flags: decide which features the sheet offers at all.
    expect(useVersionCompatStore().moduleVersion).toBeUndefined()
    expect(useVersionCompatStore().moduleCapabilities).toEqual([])
    // The manual-roll rule belongs to the world that announced it.
    expect(useGmPolicyStore().manualRollsBlocked).toBe(false)
    // Ring art would otherwise be drawn on the new world's avatars.
    expect(useTokenRingStore().spritesheet).toBeUndefined()
    // Mirrored targets resolve to token ids from a scene in another world.
    expect(useTargetHelperStore().getTargets()).toEqual({ sceneId: null, tokenIds: [] })
  })

  // The seamless-resume case: reconnecting to the SAME server must not throw
  // away what that world has already told us, or every reconnect would blank
  // the GM and re-grey every affordance until the module next announced.
  it('keeps it all when the same server is re-activated', () => {
    const address = useServerAddressStore()
    address.selectServer(ACTIVE)
    loadWorldScopedState()

    address.selectServer(ACTIVE)

    expect(useListenersStore().isListening).toBe(true)
    expect(useVersionCompatStore().moduleVersion).toBe('1.4.0')
    expect(useGmPolicyStore().manualRollsBlocked).toBe(true)
    expect(useTokenRingStore().spritesheet).toBe('modules/themed/rings.json')
  })
})
