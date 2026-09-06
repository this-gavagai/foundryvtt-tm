// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The whole point of publishing into a world setting is that the app needs
// nobody online. So the assertion that matters is a negative one: the RPC is
// never sent.
// Hoisted, because vi.mock factories run before module-scope consts exist.
const { getLabelCatalogs, world } = vi.hoisted(() => ({
  getLabelCatalogs: vi.fn(),
  world: { value: undefined as unknown }
}))
vi.mock('@/api/actionRpc', () => ({ getLabelCatalogs }))
// Pinia unwraps refs on the store object, so the real call site reads
// `useWorldStore().world` as the value, not as a ref. The mock has to match, or
// every path bails early and the tests pass by doing nothing.
vi.mock('@/stores/world', () => ({
  useWorldStore: () => ({
    get world() {
      return world.value
    }
  })
}))
vi.mock('@/stores/serverAddress', () => ({
  useServerAddressStore: () => ({ serverUrl: { origin: 'https://foundry.example' } })
}))
vi.mock('@/utils/labelCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/labelCache')>()),
  loadLabelCatalogs: vi.fn(async () => undefined),
  saveLabelCatalogs: vi.fn(async () => undefined)
}))

import { useLabelCatalogsStore } from '@/stores/labelCatalogs'

const STAMP = 'pf2e@8.4.1|en|0.1.9'

// A handshake, with the catalog published into it the way Foundry delivers a
// setting: the stored value, JSON-encoded. The value is itself JSON, so it
// arrives double-encoded.
function handshake(payload: unknown, systemVersion = '8.4.1') {
  return {
    system: { id: 'pf2e', version: systemVersion },
    modules: [{ id: 'tablemate', version: '0.1.9' }],
    settings:
      payload === undefined
        ? []
        : [{ key: 'tablemate.labelCatalogs', value: JSON.stringify(JSON.stringify(payload)) }]
  }
}

const catalogs = {
  traits: { elf: 'Elf', 'cold-iron': 'Cold Iron' },
  proficiencies: {},
  rollOptions: {},
  iwr: {},
  languages: { common: 'Common' },
  frequencies: {}
}

describe('adopting a catalog published in the world', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getLabelCatalogs.mockReset()
    world.value = undefined
  })

  it('takes the published catalog without asking anyone', async () => {
    world.value = handshake({ stamp: STAMP, catalogs })
    const store = useLabelCatalogsStore()
    await store.ensureFromWorld()

    expect(store.catalogs.traits['cold-iron']).toBe('Cold Iron')
    // The claim: no client had to be online.
    expect(getLabelCatalogs).not.toHaveBeenCalled()
  })

  // The stamp stored is the PUBLISHER'S, never the app's guess — the invariant
  // the whole stamp mechanism is built around.
  it('records the publisher’s stamp', async () => {
    world.value = handshake({ stamp: STAMP, catalogs })
    const store = useLabelCatalogsStore()
    await store.ensureFromWorld()
    expect(store.stamp).toBe(STAMP)
  })

  it('falls back to asking when the published catalog is for an older system', async () => {
    // Published under 8.4.1; the world has since upgraded to 8.5.0.
    world.value = handshake({ stamp: STAMP, catalogs }, '8.5.0')
    getLabelCatalogs.mockResolvedValue({ stamp: 'pf2e@8.5.0|en|0.1.9', catalogs })
    const store = useLabelCatalogsStore()
    await store.ensureFromWorld()

    expect(getLabelCatalogs).toHaveBeenCalledTimes(1)
    expect(store.stamp).toBe('pf2e@8.5.0|en|0.1.9')
  })

  it('falls back to asking when the world has published nothing', async () => {
    world.value = handshake(undefined)
    getLabelCatalogs.mockResolvedValue({ stamp: STAMP, catalogs })
    const store = useLabelCatalogsStore()
    await store.ensureFromWorld()
    expect(getLabelCatalogs).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all before the handshake has landed', async () => {
    world.value = undefined
    const store = useLabelCatalogsStore()
    await store.ensureFromWorld()
    expect(getLabelCatalogs).not.toHaveBeenCalled()
  })

  it('is idempotent: a second connect adopts nothing and asks nobody', async () => {
    world.value = handshake({ stamp: STAMP, catalogs })
    const store = useLabelCatalogsStore()
    await store.ensureFromWorld()
    await store.ensureFromWorld()
    expect(getLabelCatalogs).not.toHaveBeenCalled()
    expect(store.stamp).toBe(STAMP)
  })
})
