// @vitest-environment jsdom
// The status poll reads serverUrl (localStorage-backed) and calls fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { useWorldStore } from '@/stores/world'
import { useServerAddressStore } from '@/stores/serverAddress'

// A world request that times out used to be the end of it. sendWorldRequest
// marks worldLoaded from /api/status *before* asking for the payload, so a
// timeout left worldLoaded true with no world data — and the poll's retry was
// gated on `worldLoaded !== true`, the one thing that was no longer false. In a
// foregrounded app on a live socket nothing else re-asks, so the app waited
// forever on a payload no one was going to request again.

const POLL_INTERVAL_MS = 8000

function loadedWorld(): GamePF2e {
  return { userId: 'gm', actors: [], users: [], messages: [] } as unknown as GamePF2e
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ active: true }) }))
  )
  useServerAddressStore().serverUrl = new URL('https://example.invalid')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function pollOnce() {
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 10)
}

describe('status poll retry', () => {
  it('re-requests the world when the payload is missing despite worldLoaded', async () => {
    const status = useFoundryWorldStatusStore()
    const world = useWorldStore()
    const refresh = vi.spyOn(world, 'refreshWorld').mockImplementation(() => undefined)

    // Exactly the state a timed-out request leaves behind.
    status.markWorldLoaded()
    expect(world.world).toBeUndefined()

    status.start()
    await pollOnce()

    expect(refresh).toHaveBeenCalled()
  })

  it('stops re-requesting once the world data has landed', async () => {
    const status = useFoundryWorldStatusStore()
    const world = useWorldStore()
    const refresh = vi.spyOn(world, 'refreshWorld').mockImplementation(() => undefined)

    status.markWorldLoaded()
    world.world = loadedWorld()

    status.start()
    await pollOnce()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not stack a retry on a request already in flight', async () => {
    const status = useFoundryWorldStatusStore()
    const world = useWorldStore()
    const refresh = vi.spyOn(world, 'refreshWorld').mockImplementation(() => undefined)

    // Missing payload, so the retry condition holds — but a request is already
    // out for it, and the payload is far too large to fetch twice over.
    status.markWorldLoaded()
    world.requestInFlight = true

    status.start()
    await pollOnce()

    expect(refresh).not.toHaveBeenCalled()
  })
})
