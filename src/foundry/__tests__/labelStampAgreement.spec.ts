// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { labelCatalogStamp } from '@/foundry/utils/labels'
import { expectedLabelStamp } from '@/utils/labelStamp'

// The stamp has two implementations, in two files, on two sides of a socket:
// the module builds it from a live Foundry client, and the app reconstructs it
// from the handshake so it can tell whether its cached catalog is current
// without waiting for a GM to be online.
//
// Testing either alone proves nothing about the pair. The whole mechanism turns
// on the strings being byte-identical — a format change on one side makes every
// connect refetch the catalog, quietly and forever — so these drive BOTH from
// one description of a world and compare the outputs.

// One world, expressed the way each side receives it.
function bothSides(over: {
  systemId?: string
  systemVersion?: string
  lang?: string
  moduleVersion?: string
}) {
  const { systemId = 'pf2e', systemVersion = '8.4.1', lang = 'en', moduleVersion } = over

  // The module's view: globals off a live client.
  ;(globalThis as Record<string, unknown>).game = {
    system: { id: systemId, version: systemVersion },
    i18n: { lang },
    modules: { get: (id: string) => (id === 'tablemate' ? { version: moduleVersion } : undefined) }
  }

  // The app's view: the socket handshake. A locale left at the default writes
  // no setting document at all, which is why `en` is expressed as its absence.
  const handshake = {
    system: { id: systemId, version: systemVersion },
    modules: moduleVersion === undefined ? [] : [{ id: 'tablemate', version: moduleVersion }],
    settings: lang === 'en' ? [] : [{ key: 'core.language', value: JSON.stringify(lang) }]
  }

  return { module: labelCatalogStamp(), app: expectedLabelStamp(handshake) }
}

describe('the two label stamps agree', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).game
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).game
  })

  it('on an ordinary world', () => {
    const { module, app } = bothSides({ moduleVersion: '0.1.9' })
    expect(app).toBe(module)
    expect(module).toBe('pf2e@8.4.1|en|0.1.9')
  })

  it('on a non-English world', () => {
    const { module, app } = bothSides({ lang: 'de', moduleVersion: '0.1.9' })
    expect(app).toBe(module)
    expect(module).toContain('|de|')
  })

  it('when the module reports no version of its own', () => {
    // The module templates `string | undefined` into the stamp, so it really
    // does announce the literal "undefined". The app has to match the quirk.
    const { module, app } = bothSides({ moduleVersion: undefined })
    expect(app).toBe(module)
    expect(module).toContain('|undefined')
  })

  it('across a system upgrade — the case the whole mechanism exists for', () => {
    const before = bothSides({ systemVersion: '8.4.1', moduleVersion: '0.1.9' })
    const after = bothSides({ systemVersion: '8.5.0', moduleVersion: '0.1.9' })
    expect(before.app).toBe(before.module)
    expect(after.app).toBe(after.module)
    // The app must see the difference from the handshake alone, with no GM
    // online to tell it.
    expect(after.app).not.toBe(before.app)
  })
})
