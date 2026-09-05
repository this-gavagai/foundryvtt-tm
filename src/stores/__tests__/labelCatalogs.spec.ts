import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StoredLabelCatalogs, LabelCatalogs } from '@/utils/labelCache'
import { labelPayload } from '@/utils/__tests__/fixtures/labelPayload'

// The world's label catalogs are fetched at most once per stamp and then kept
// indefinitely — which is what lets the sheet name everything it renders with no
// GM online. These cover the rules that make that safe: when a fetch happens,
// when it does not, and that a row read for one server never lands on another.

const ACTIVE = 'https://table.example.com'
const STAMP = 'pf2e@8.4.1|en|1.4.0'
let origin: string | undefined = ACTIVE

vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({
    get serverUrl() {
      return origin ? new URL(origin) : undefined
    }
  })
}))

// vi.hoisted: the vi.mock factories are lifted above every top-level const, so
// the spies they return have to be created in a block lifted with them.
const { loadLabelCatalogs, saveLabelCatalogs, getLabelCatalogs } = vi.hoisted(() => ({
  loadLabelCatalogs: vi.fn<() => Promise<StoredLabelCatalogs | undefined>>(),
  saveLabelCatalogs: vi.fn(() => Promise.resolve()),
  getLabelCatalogs: vi.fn()
}))

vi.mock('@/utils/labelCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/labelCache')>()
  return { ...actual, loadLabelCatalogs, saveLabelCatalogs }
})
vi.mock('@/api/actionRpc', () => ({ getLabelCatalogs }))

import { useLabelCatalogsStore } from '@/stores/labelCatalogs'
import { emptyLabelCatalogs } from '@/utils/labelCache'

function worldCatalogs(traits: Record<string, string>): LabelCatalogs {
  return { ...emptyLabelCatalogs(), traits }
}

beforeEach(() => {
  setActivePinia(createPinia())
  origin = ACTIVE
  vi.clearAllMocks()
  loadLabelCatalogs.mockResolvedValue(undefined)
  getLabelCatalogs.mockResolvedValue({
    stamp: STAMP,
    catalogs: worldCatalogs({ finesse: 'Finesse' })
  })
})

describe('ensureCatalog', () => {
  it('fetches the world catalog when nothing is held', async () => {
    const store = useLabelCatalogsStore()
    await store.ensureCatalog(STAMP)
    expect(store.catalogs.traits).toEqual({ finesse: 'Finesse' })
    expect(store.stamp).toBe(STAMP)
  })

  it('does not fetch again while the world announces the same stamp', async () => {
    // The heartbeat announces every 30s from every GM at the table. Refetching
    // on each one would be the single most wasteful thing this store could do.
    const store = useLabelCatalogsStore()
    await store.ensureCatalog(STAMP)
    await store.ensureCatalog(STAMP)
    await store.ensureCatalog(STAMP)
    expect(getLabelCatalogs).toHaveBeenCalledTimes(1)
  })

  it('REPLACES the catalog when the stamp moves', async () => {
    // A new stamp means the locale or the system changed, so everything gathered
    // under the old one is stale — including rule labels merged from payloads.
    const store = useLabelCatalogsStore()
    await store.ensureCatalog(STAMP)
    store.remember(labelPayload({ rollOptionLabels: { old: 'Old' } }))
    expect(store.catalogs.rollOptions).toEqual({ old: 'Old' })

    getLabelCatalogs.mockResolvedValue({
      stamp: 'pf2e@8.5.0|de|1.4.0',
      catalogs: worldCatalogs({ finesse: 'Finesse (de)' })
    })
    await store.ensureCatalog('pf2e@8.5.0|de|1.4.0')

    expect(store.catalogs.traits).toEqual({ finesse: 'Finesse (de)' })
    expect(store.catalogs.rollOptions).toEqual({})
  })

  it('does nothing for a module too old to announce a stamp', async () => {
    // Whatever is cached stays — stale wording beats raw slugs, and there is no
    // catalog to fetch from such a module anyway.
    const store = useLabelCatalogsStore()
    await store.ensureCatalog(STAMP)
    await store.ensureCatalog(undefined)
    expect(getLabelCatalogs).toHaveBeenCalledTimes(1)
    expect(store.catalogs.traits).toEqual({ finesse: 'Finesse' })
  })

  it('collapses concurrent announcements into one fetch', async () => {
    let release: (value: unknown) => void = () => {}
    getLabelCatalogs.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const store = useLabelCatalogsStore()
    const a = store.ensureCatalog(STAMP)
    const b = store.ensureCatalog(STAMP)
    release({ stamp: STAMP, catalogs: worldCatalogs({ finesse: 'Finesse' }) })
    await Promise.all([a, b])
    expect(getLabelCatalogs).toHaveBeenCalledTimes(1)
  })

  it('keeps what it has when the fetch fails', async () => {
    // A GM that drops mid-request must not blank every label on screen; the next
    // announcement retries.
    const store = useLabelCatalogsStore()
    await store.ensureCatalog(STAMP)
    getLabelCatalogs.mockRejectedValue(new Error('no listener'))
    await store.ensureCatalog('pf2e@8.5.0|en|1.4.0')
    expect(store.catalogs.traits).toEqual({ finesse: 'Finesse' })
  })

  it('discards an answer that arrives after the server changed under it', async () => {
    let release: (value: unknown) => void = () => {}
    getLabelCatalogs.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const store = useLabelCatalogsStore()
    const pending = store.ensureCatalog(STAMP)
    origin = 'https://other.example.com'
    release({ stamp: STAMP, catalogs: worldCatalogs({ finesse: 'Finesse' }) })
    await pending
    expect(store.catalogs.traits).toEqual({})
  })
})

describe('hydrate', () => {
  it('paints from the stored row before any GM answers', async () => {
    // The point of persisting: a cold start with no GM online still names its
    // traits, because the catalog came off disk.
    loadLabelCatalogs.mockResolvedValue({
      stamp: STAMP,
      catalogs: worldCatalogs({ agile: 'Agile' })
    })
    const store = useLabelCatalogsStore()
    await store.hydrate()
    expect(store.catalogs.traits).toEqual({ agile: 'Agile' })
    expect(store.stamp).toBe(STAMP)
  })

  it('means a matching announcement costs no round trip at all', async () => {
    loadLabelCatalogs.mockResolvedValue({
      stamp: STAMP,
      catalogs: worldCatalogs({ agile: 'Agile' })
    })
    const store = useLabelCatalogsStore()
    await store.ensureCatalog(STAMP)
    expect(getLabelCatalogs).not.toHaveBeenCalled()
    expect(store.catalogs.traits).toEqual({ agile: 'Agile' })
  })

  it('puts the disk row UNDERNEATH labels already merged this session', async () => {
    loadLabelCatalogs.mockResolvedValue({
      stamp: STAMP,
      catalogs: { ...emptyLabelCatalogs(), rollOptions: { a: 'Stale', b: 'Beta' } }
    })
    const store = useLabelCatalogsStore()
    store.remember(labelPayload({ rollOptionLabels: { a: 'Alpha' } }))
    await store.hydrate()
    expect(store.catalogs.rollOptions).toEqual({ a: 'Alpha', b: 'Beta' })
  })

  it('reads disk once per server', async () => {
    loadLabelCatalogs.mockResolvedValue({
      stamp: STAMP,
      catalogs: worldCatalogs({ agile: 'Agile' })
    })
    const store = useLabelCatalogsStore()
    await store.hydrate()
    await store.hydrate()
    expect(loadLabelCatalogs).toHaveBeenCalledTimes(1)
  })

  it('re-reads after a reset so a returning server gets its own row', async () => {
    loadLabelCatalogs.mockResolvedValue({
      stamp: STAMP,
      catalogs: worldCatalogs({ agile: 'Agile' })
    })
    const store = useLabelCatalogsStore()
    await store.hydrate()
    store.reset()
    expect(store.catalogs.traits).toEqual({})
    expect(store.stamp).toBeUndefined()
    await store.hydrate()
    expect(loadLabelCatalogs).toHaveBeenCalledTimes(2)
    expect(store.catalogs.traits).toEqual({ agile: 'Agile' })
  })
})

describe('remember', () => {
  it('accumulates rule labels across payloads for different actors', () => {
    const store = useLabelCatalogsStore()
    store.remember(labelPayload({ rollOptionLabels: { a: 'Alpha' } }))
    store.remember(labelPayload({ rollOptionLabels: { b: 'Beta' } }))
    expect(store.catalogs.rollOptions).toEqual({ a: 'Alpha', b: 'Beta' })
  })

  it('does not touch the ref when a payload repeats what is already held', () => {
    const store = useLabelCatalogsStore()
    store.remember(labelPayload({ rollOptionLabels: { a: 'Alpha' } }))
    const before = store.catalogs
    store.remember(labelPayload({ rollOptionLabels: { a: 'Alpha' } }))
    expect(store.catalogs).toBe(before)
  })

  it('ignores a payload that arrives with no active server', () => {
    origin = undefined
    const store = useLabelCatalogsStore()
    store.remember(labelPayload({ rollOptionLabels: { a: 'Alpha' } }))
    expect(store.catalogs.rollOptions).toEqual({})
  })
})
