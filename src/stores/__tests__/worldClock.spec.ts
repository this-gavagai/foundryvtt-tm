// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorldStore } from '@/stores/world'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// The world clock is what turns an effect's remaining duration from a snapshot
// into an answer. It is a plain world-scope Foundry setting (`core.time`,
// holding seconds as JSON), so it arrives in the payload the server dumps — no
// GM, no round trip — and it is mutated in place by the socket branch for
// Setting documents, which is why the computed hangs off its own revision
// counter rather than off the shallow `world` ref.

// `world` is a huge Foundry type the app only ever reads a few collections
// from; a spec builds the collections under test and nothing else.
const worldWith = (settings: unknown) => ({ settings }) as unknown as GamePF2e

const setting = (key: string, value: string, user: string | null = null) => ({ key, value, user })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
})

describe('worldTime', () => {
  it('reads core.time out of the world payload', () => {
    const store = useWorldStore()
    store.world = worldWith([setting('core.time', '1800')])
    expect(store.worldTime).toBe(1800)
  })

  it('is zero for a world that has not sent one', () => {
    // The honest fallback rather than a guess: an effect's start stamp is
    // measured against the same zero, so nothing reads as wildly expired.
    const store = useWorldStore()
    store.world = worldWith([])
    expect(store.worldTime).toBe(0)
    store.world = undefined
    expect(store.worldTime).toBe(0)
  })

  it('prefers the world entry over a per-user copy of the same key', () => {
    // readWorldSetting's rule, and it matters here: answering a world question
    // with one player's client-scope value would skew every duration on the
    // sheet by whatever that copy held.
    const store = useWorldStore()
    store.world = worldWith([
      setting('core.time', '99', 'user-1'),
      setting('core.time', '1800'),
      setting('core.time', '5', 'user-2')
    ])
    expect(store.worldTime).toBe(1800)
  })

  it('follows an in-place update once the revision is bumped', () => {
    // This is the shape of what the socket branch does: processChanges mutates
    // the settings array in place, then bumps. Without the bump the computed
    // has nothing to invalidate on and the clock stops.
    const store = useWorldStore()
    const settings = [setting('core.time', '1800')]
    store.world = worldWith(settings)
    expect(store.worldTime).toBe(1800)

    settings[0].value = '1806'
    store.bumpSettingsRevision()
    expect(store.worldTime).toBe(1806)
  })

  it('survives a setting that is not valid JSON', () => {
    const store = useWorldStore()
    store.world = worldWith([setting('core.time', 'not json')])
    expect(store.worldTime).toBe(0)
  })
})
