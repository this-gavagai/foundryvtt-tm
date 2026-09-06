// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { publishLabelCatalogs, PUBLISHED_LABELS_SETTING } from '@/foundry/publishedLabels'
import { readPublishedCatalogs } from '@/utils/labelStamp'
import { coerceLabelCatalogs } from '@/utils/labelCache'

// The module writes the catalogs into a world setting; the app reads them back
// out of the socket handshake. The two are joined by nothing but a key string
// and a payload shape, on opposite sides of a wire — which is the same setup
// that let an earlier harness compare a field the sheet reads against a field
// the payload does not carry, and pass.
//
// So these drive the REAL publisher, take what it stored, dress it the way
// Foundry delivers a setting document, and hand it to the REAL reader.

const store = new Map<string, unknown>()

// How Foundry delivers a setting in the handshake: `value` is the stored value
// JSON-encoded. Verified against a live world — a String setting holding
// "coreBronze" arrives as the five-character JSON string `"coreBronze"` — so a
// payload that is itself JSON arrives double-encoded, and the reader has to
// unwrap twice.
function asHandshakeSetting(key: string, value: unknown) {
  return { key, value: JSON.stringify(value) }
}

function world(settings: { key: string; value: unknown }[]) {
  return {
    system: { id: 'pf2e', version: '8.4.1' },
    modules: [{ id: 'tablemate', version: '0.1.9' }],
    settings
  }
}

beforeEach(() => {
  store.clear()
  ;(globalThis as Record<string, unknown>).game = {
    system: { id: 'pf2e', version: '8.4.1' },
    i18n: { lang: 'en', localize: (key: string) => `L(${key})` },
    modules: { get: () => ({ version: '0.1.9' }) },
    settings: {
      register: vi.fn(),
      get: (module: string, key: string) => store.get(`${module}.${key}`),
      set: async (module: string, key: string, value: unknown) => {
        store.set(`${module}.${key}`, value)
      }
    }
  }
  ;(globalThis as Record<string, unknown>).CONFIG = {
    PF2E: {
      creatureTraits: { elf: 'PF2E.TraitElf', 'cold-iron': 'PF2E.TraitColdIron' },
      weaponCategories: { simple: 'PF2E.WeaponSimple' },
      armorCategories: { unarmored: 'PF2E.ArmorUnarmored' },
      skills: {},
      languages: { common: 'PF2E.LanguageCommon' }
    }
  }
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).game
  delete (globalThis as Record<string, unknown>).CONFIG
})

// What the publisher put in the store, delivered as the app would receive it.
function published() {
  return asHandshakeSetting(
    `tablemate.${PUBLISHED_LABELS_SETTING}`,
    store.get(`tablemate.${PUBLISHED_LABELS_SETTING}`)
  )
}

describe('published label catalogs, module to app', () => {
  it('round-trips: what the publisher writes is what the reader reads', async () => {
    await publishLabelCatalogs()
    const read = readPublishedCatalogs(world([published()]))

    expect(read?.stamp).toBe('pf2e@8.4.1|en|0.1.9')
    const catalogs = coerceLabelCatalogs(read?.catalogs)
    expect(catalogs.traits.elf).toBe('L(PF2E.TraitElf)')
    expect(catalogs.languages.common).toBe('L(PF2E.LanguageCommon)')
  })

  // The publisher's own guard: a 40KB write on every GM's every page load, for
  // a value that changes on a system upgrade, would be pure noise.
  it('writes nothing when the stored stamp already matches', async () => {
    await publishLabelCatalogs()
    const first = store.get(`tablemate.${PUBLISHED_LABELS_SETTING}`)
    const settings = (globalThis as unknown as { game: { settings: Record<string, unknown> } }).game
      .settings
    const setSpy = vi.spyOn(settings, 'set' as never)
    await publishLabelCatalogs()
    expect(setSpy).not.toHaveBeenCalled()
    expect(store.get(`tablemate.${PUBLISHED_LABELS_SETTING}`)).toBe(first)
  })

  it('republishes when the system version moves', async () => {
    await publishLabelCatalogs()
    const before = readPublishedCatalogs(world([published()]))
    ;(globalThis as unknown as { game: { system: { version: string } } }).game.system.version =
      '8.5.0'
    await publishLabelCatalogs()
    const after = readPublishedCatalogs(world([published()]))

    expect(before?.stamp).not.toBe(after?.stamp)
    expect(after?.stamp).toContain('8.5.0')
  })
})

describe('the reader refuses anything it cannot trust', () => {
  it('reports nothing when the world has never published', () => {
    expect(readPublishedCatalogs(world([]))).toBeUndefined()
    expect(readPublishedCatalogs(undefined)).toBeUndefined()
  })

  it('reports nothing for a payload it cannot parse or that lacks a stamp', () => {
    const key = `tablemate.${PUBLISHED_LABELS_SETTING}`
    expect(readPublishedCatalogs(world([{ key, value: 'not json at all' }]))).toBeUndefined()
    expect(
      readPublishedCatalogs(world([asHandshakeSetting(key, JSON.stringify({ catalogs: {} }))]))
    ).toBeUndefined()
    expect(
      readPublishedCatalogs(world([asHandshakeSetting(key, JSON.stringify({ stamp: 'x' }))]))
    ).toBeUndefined()
  })
})

describe('coerceLabelCatalogs survives version skew both ways', () => {
  it('drops a family a newer module added, keeping the rest', () => {
    const out = coerceLabelCatalogs({ traits: { elf: 'Elf' }, somethingNew: { a: 'b' } })
    expect(out.traits).toEqual({ elf: 'Elf' })
    expect((out as unknown as Record<string, unknown>).somethingNew).toBeUndefined()
  })

  it('empties a family an older module omitted rather than failing whole', () => {
    const out = coerceLabelCatalogs({ traits: { elf: 'Elf' } })
    expect(out.traits.elf).toBe('Elf')
    expect(out.languages).toEqual({})
  })

  it('drops non-string labels', () => {
    const out = coerceLabelCatalogs({ traits: { elf: 'Elf', bad: 7, worse: null } })
    expect(out.traits).toEqual({ elf: 'Elf' })
  })
})
