import { describe, it, expect } from 'vitest'
import { expectedLabelStamp } from '@/utils/labelStamp'

// The app's guess at the stamp the world's module would announce. It is only
// ever compared, never stored, so the bar is "matches the module's format
// exactly" rather than "is a sensible string".
const world = (over: Record<string, unknown> = {}) => ({
  system: { id: 'pf2e', version: '8.4.1' },
  modules: [
    { id: 'babele', version: '2.0.0' },
    { id: 'tablemate', version: '0.1.9' }
  ],
  settings: [{ key: 'core.time', value: '78' }],
  ...over
})

describe('expectedLabelStamp', () => {
  // Compared against labelCatalogStamp() in foundry/utils/labels.ts:
  //   `${system.id}@${system.version}|${i18n.lang}|${moduleVersion()}`
  it('reproduces the module’s format', () => {
    expect(expectedLabelStamp(world())).toBe('pf2e@8.4.1|en|0.1.9')
  })

  it('reads the world locale out of the settings, JSON-encoded as they arrive', () => {
    const de = world({ settings: [{ key: 'core.language', value: '"de"' }] })
    expect(expectedLabelStamp(de)).toBe('pf2e@8.4.1|de|0.1.9')
  })

  it('defaults the locale to en when the setting has never been written', () => {
    // Foundry stores no document for a setting left at its default, so `de`
    // worlds are distinguishable from untouched ones only by its presence.
    expect(expectedLabelStamp(world({ settings: [] }))).toContain('|en|')
  })

  it('tolerates a locale that is not JSON rather than defaulting a real world to en', () => {
    const raw = world({ settings: [{ key: 'core.language', value: 'de' }] })
    expect(expectedLabelStamp(raw)).toContain('|de|')
  })

  // Not tidiness — the module templates a `string | undefined` into the same
  // slot, so "undefined" is genuinely the string it announces. A prettier stamp
  // here would never match one from there.
  it('reproduces the module’s literal "undefined" for an absent module version', () => {
    expect(expectedLabelStamp(world({ modules: [] }))).toBe('pf2e@8.4.1|en|undefined')
  })

  it('gives nothing at all before the handshake has landed', () => {
    // A stamp of `unknown@0|en|undefined` would match nothing and refetch the
    // catalog on every single connect.
    expect(expectedLabelStamp(undefined)).toBeUndefined()
    expect(expectedLabelStamp({})).toBeUndefined()
    expect(expectedLabelStamp({ system: {} })).toBeUndefined()
  })

  it('still answers when only half the system block arrived', () => {
    expect(expectedLabelStamp({ system: { id: 'pf2e' } })).toBe('pf2e@0|en|undefined')
  })
})
