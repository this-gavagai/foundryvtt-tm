import { describe, it, expect, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { registerStoreBridge, resetStoreBridgeForTest, requireStoreBridge } from '@/api/storeBridge'
import { getUserId, waitForAuthenticatedSession, getAuthenticatedSocket } from '@/api/internal'
import { fakeStoreBridge } from './socketMock'

// The store bridge is the seam that lets the api layer run without Pinia. These
// tests exercise api/internal.ts entirely through an injected fake bridge — no
// store, no network — which is exactly the testability the inversion unlocked.
// (Before it, importing internal.ts pulled in the server/user stores and their
// first-use side effects, so none of this was reachable in a unit test.)

afterEach(() => {
  resetStoreBridgeForTest()
  vi.useRealTimers()
})

describe('requireStoreBridge', () => {
  it('throws a pointed error when no bridge is registered', () => {
    expect(() => requireStoreBridge()).toThrow(/store bridge not registered/i)
  })
})

describe('api/internal through an injected bridge (no Pinia)', () => {
  it('getUserId reads straight from the bridge', () => {
    registerStoreBridge(fakeStoreBridge({ getUserId: () => 'user-42' }))
    expect(getUserId()).toBe('user-42')
  })

  it('waitForAuthenticatedSession resolves immediately when the session is ready', async () => {
    registerStoreBridge(fakeStoreBridge({ sessionReady: () => true, userId: () => 'ready-user' }))
    await expect(waitForAuthenticatedSession()).resolves.toBe('ready-user')
  })

  it('waitForAuthenticatedSession waits for a reactive session, then resolves', async () => {
    // Reactive getters: the bridge reads refs, so the internal `watch` tracks
    // them and fires when the session flips ready — with no store in sight.
    const ready = ref(false)
    const uid = ref('')
    registerStoreBridge(
      fakeStoreBridge({ sessionReady: () => ready.value, userId: () => uid.value })
    )

    const pending = waitForAuthenticatedSession()
    ready.value = true
    uid.value = 'late-user'
    await expect(pending).resolves.toBe('late-user')
  })

  it('waitForAuthenticatedSession rejects on timeout if the session never arrives', async () => {
    vi.useFakeTimers()
    registerStoreBridge(fakeStoreBridge({ sessionReady: () => false, userId: () => '' }))

    const pending = waitForAuthenticatedSession(5_000)
    const expectation = expect(pending).rejects.toThrow(/session not available/i)
    await vi.advanceTimersByTimeAsync(5_000)
    await expectation
  })

  it('getAuthenticatedSocket returns the bridge socket once the session is ready', async () => {
    const socket = { emit: () => {} }
    registerStoreBridge(
      fakeStoreBridge({
        sessionReady: () => true,
        userId: () => 'u',
        getSocket: async () => socket as never
      })
    )
    await expect(getAuthenticatedSocket()).resolves.toEqual({ socket, userId: 'u' })
  })
})
