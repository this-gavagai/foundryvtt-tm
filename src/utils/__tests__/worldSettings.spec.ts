import { describe, it, expect } from 'vitest'
import { readModuleFlag, readWorldSetting } from '@/utils/worldSettings'

// World-scope settings ride in core's world dump, so the app can read them with
// no round-trip and — the point — with no GM online. That is what lets the
// reaction and comment affordances appear at a table whose GM has closed their
// laptop, now that both are written directly by their author.
//
// Reads fail CLOSED, matching foundry/featureToggles.ts: anything absent or
// unparseable is off, which can only ever withhold a feature and never leak one.

const setting = (key: string, value: string, user: string | null = null) => ({ key, value, user })

describe('readWorldSetting', () => {
  it('parses the JSON-encoded value core stores', () => {
    expect(
      readWorldSetting(
        [setting('tablemate.reactionsEnabled', 'true')],
        'tablemate.reactionsEnabled',
        false
      )
    ).toBe(true)
    expect(readWorldSetting([setting('a.b', '42')], 'a.b', 0)).toBe(42)
    expect(readWorldSetting([setting('a.b', '"text"')], 'a.b', '')).toBe('text')
  })

  it('falls back when the setting is not there', () => {
    expect(readWorldSetting([], 'a.b', 'fallback')).toBe('fallback')
    expect(readWorldSetting(undefined, 'a.b', 'fallback')).toBe('fallback')
  })

  it('falls back rather than throwing on a value that is not JSON', () => {
    expect(readWorldSetting([setting('a.b', '{not json')], 'a.b', 'fallback')).toBe('fallback')
  })

  it('falls back for a null value, which is the field’s own default', () => {
    expect(readWorldSetting([setting('a.b', 'null')], 'a.b', 'fallback')).toBe('fallback')
  })

  // The same key can exist per-user as well. Taking the first match would
  // answer a world question with one player's client-scope preference.
  it('prefers the world-scope entry over a per-user one', () => {
    const settings = [
      setting('a.b', 'false', 'user-1'),
      setting('a.b', 'true', null),
      setting('a.b', 'false', 'user-2')
    ]
    expect(readWorldSetting(settings, 'a.b', false)).toBe(true)
  })

  it('accepts a collection-shaped payload as well as an array', () => {
    expect(readWorldSetting({ contents: [setting('a.b', 'true')] }, 'a.b', false)).toBe(true)
  })
})

describe('readModuleFlag', () => {
  it('reads a module setting by its bare field name', () => {
    expect(readModuleFlag([setting('tablemate.commentsEnabled', 'true')], 'commentsEnabled')).toBe(
      true
    )
  })

  it('is off by default, and off for anything that is not literally true', () => {
    expect(readModuleFlag([], 'commentsEnabled')).toBe(false)
    expect(readModuleFlag([setting('tablemate.commentsEnabled', 'false')], 'commentsEnabled')).toBe(
      false
    )
    // A truthy value that is not `true` — a schema that has moved, or a
    // hand-edited world. Off, not on.
    expect(readModuleFlag([setting('tablemate.commentsEnabled', '"yes"')], 'commentsEnabled')).toBe(
      false
    )
    expect(readModuleFlag([setting('tablemate.commentsEnabled', '1')], 'commentsEnabled')).toBe(
      false
    )
  })

  // A module that never ran here registered no settings, so the absent entry
  // doubles as the version check the advertised capability used to provide.
  it('is off against a world where the module has never run', () => {
    expect(readModuleFlag([setting('core.somethingElse', 'true')], 'reactionsEnabled')).toBe(false)
  })
})
