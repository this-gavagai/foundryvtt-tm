import { describe, it, expect } from 'vitest'
import { sanitizeActorUpdate } from '@/foundry/handlers/updateActor'

// The actor-update sanitizer is the module's write-side security boundary:
// updates run with GM rights, so only the exact paths the app edits may pass.
// The old blocklist checked just the first path segment; these tests pin the
// allowlist semantics, including the nested/dot-notation equivalence.

describe('sanitizeActorUpdate', () => {
  it('passes an allowed nested update through as a dotted path', () => {
    const { clean, dropped } = sanitizeActorUpdate({
      system: { attributes: { hp: { value: 12 } } }
    })
    expect(clean).toEqual({ 'system.attributes.hp.value': 12 })
    expect(dropped).toEqual([])
  })

  it('treats dot-notation and nested forms identically', () => {
    const nested = sanitizeActorUpdate({ system: { resources: { heroPoints: { value: 2 } } } })
    const dotted = sanitizeActorUpdate({ 'system.resources.heroPoints.value': 2 })
    expect(dotted).toEqual(nested)
  })

  it('keeps multiple allowed leaves from one update', () => {
    const { clean, dropped } = sanitizeActorUpdate({
      system: { attributes: { hp: { value: 5, temp: 3 } } }
    })
    expect(clean).toEqual({
      'system.attributes.hp.value': 5,
      'system.attributes.hp.temp': 3
    })
    expect(dropped).toEqual([])
  })

  it('allows every path the app actually sends', () => {
    const appUpdates: Record<string, unknown>[] = [
      { system: { attributes: { hp: { value: 20 } } } },
      { system: { attributes: { hp: { temp: 4 } } } },
      { system: { resources: { heroPoints: { value: 1 } } } },
      { system: { resources: { focus: { value: 2 } } } },
      { system: { details: { xp: { value: 640 } } } },
      { system: { initiative: { statistic: 'stealth' } } },
      {
        flags: {
          'pf2e-dailies': { extra: { dailies: { staves: { charges: { value: 3 } } } } }
        }
      }
    ]
    for (const update of appUpdates) {
      const { clean, dropped } = sanitizeActorUpdate(update)
      expect(dropped, JSON.stringify(update)).toEqual([])
      expect(Object.keys(clean), JSON.stringify(update)).toHaveLength(1)
    }
  })

  it('drops privileged roots the old blocklist also caught', () => {
    const { clean, dropped } = sanitizeActorUpdate({
      ownership: { default: 3 },
      'prototypeToken.name': 'x',
      _id: 'evil',
      type: 'npc'
    })
    expect(clean).toEqual({})
    expect(dropped).toEqual(['ownership.default', 'prototypeToken.name', '_id', 'type'])
  })

  it('drops deep writes under allowed roots (the blocklist bypass)', () => {
    const { clean, dropped } = sanitizeActorUpdate({
      // `system` and `flags` are legitimate roots, but these paths are not
      // the app's — the old first-segment blocklist let all of them through.
      system: { details: { alliance: 'opposition' } },
      flags: { tablemate: { originUserId: 'forged' } },
      'system.attributes.hp.max': 999
    })
    expect(clean).toEqual({})
    expect(dropped).toEqual([
      'system.details.alliance',
      'flags.tablemate.originUserId',
      'system.attributes.hp.max'
    ])
  })

  it('drops siblings while keeping the allowed leaf', () => {
    const { clean, dropped } = sanitizeActorUpdate({
      system: {
        attributes: { hp: { value: 9, max: 999 } }
      }
    })
    expect(clean).toEqual({ 'system.attributes.hp.value': 9 })
    expect(dropped).toEqual(['system.attributes.hp.max'])
  })

  it('does not recurse into arrays (an array leaf is a value, not a path)', () => {
    const { clean, dropped } = sanitizeActorUpdate({
      system: { attributes: { hp: { value: [1, 2] } } }
    })
    // Still an allowed path — the VALUE being an array is Foundry's problem,
    // not a path-escape.
    expect(clean).toEqual({ 'system.attributes.hp.value': [1, 2] })
    expect(dropped).toEqual([])
  })

  it('returns everything dropped for an empty or fully-forbidden update', () => {
    expect(sanitizeActorUpdate({})).toEqual({ clean: {}, dropped: [] })
    const { clean, dropped } = sanitizeActorUpdate({ name: 'New Name' })
    expect(clean).toEqual({})
    expect(dropped).toEqual(['name'])
  })
})
