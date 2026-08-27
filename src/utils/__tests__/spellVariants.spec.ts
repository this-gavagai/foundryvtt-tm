import { describe, it, expect } from 'vitest'
import { spellVariants } from '@/utils/spellVariants'

// The overlay fixture is Heal's, copied from a live world. It's the interesting
// case: four variants, two of which carry NO name of their own and have to
// inherit the spell's, which is what PF2e's own card shows ("Heal ◆",
// "Heal (vs. Living) ◆◆", "Heal (vs. Undead) ◆◆", "Heal ◆◆◆").
const HEAL = {
  name: 'Heal',
  system: {
    time: { value: '1 to 3' },
    overlays: {
      '37gy7l19tik74o4s': {
        _id: '37gy7l19tik74o4s',
        name: 'Heal (vs. Living)',
        overlayType: 'override',
        sort: 2,
        system: { time: { value: '2' }, range: { value: '30 feet' } }
      },
      '7qdtetowq348s9oc': {
        _id: '7qdtetowq348s9oc',
        overlayType: 'override',
        sort: 1,
        system: { time: { value: '1' }, range: { value: 'touch' } }
      },
      '7vbvdrv2cl87sqta': {
        _id: '7vbvdrv2cl87sqta',
        overlayType: 'override',
        sort: 4,
        system: { time: { value: '3' } }
      },
      lfxcoz2d3f8j2zq1: {
        _id: 'lfxcoz2d3f8j2zq1',
        name: 'Heal (vs. Undead)',
        overlayType: 'override',
        sort: 3,
        system: { time: { value: '2' } }
      }
    }
  }
}

describe('spellVariants', () => {
  it('lists every override overlay in sort order', () => {
    expect(spellVariants(HEAL)).toEqual([
      { overlayId: '7qdtetowq348s9oc', label: 'Heal', actionGlyph: '1', sort: 1 },
      { overlayId: '37gy7l19tik74o4s', label: 'Heal (vs. Living)', actionGlyph: '2', sort: 2 },
      { overlayId: 'lfxcoz2d3f8j2zq1', label: 'Heal (vs. Undead)', actionGlyph: '2', sort: 3 },
      { overlayId: '7vbvdrv2cl87sqta', label: 'Heal', actionGlyph: '3', sort: 4 }
    ])
  })

  // Object key order is not sort order — the fixture's keys are deliberately
  // shuffled relative to their sorts.
  it('does not rely on the overlay map order', () => {
    expect(spellVariants(HEAL).map((v) => v.sort)).toEqual([1, 2, 3, 4])
  })

  it('falls back to the spell name when an overlay has none', () => {
    const [oneAction] = spellVariants(HEAL)
    expect(oneAction.label).toBe('Heal')
  })

  it('falls back to the spell action cost when an overlay does not override it', () => {
    const spell = {
      name: 'Example',
      system: {
        time: { value: 'reaction' },
        overlays: { a: { overlayType: 'override', sort: 1, system: {} } }
      }
    }
    expect(spellVariants(spell)[0]).toMatchObject({ label: 'Example', actionGlyph: 'reaction' })
  })

  // Heightening layers are stored alongside variants but are not castable
  // choices — PF2e's overrideVariants filters on overlayType for this reason.
  it('ignores overlays that are not overrides', () => {
    const spell = {
      name: 'Example',
      system: {
        overlays: {
          a: { overlayType: 'override', sort: 1 },
          b: { overlayType: 'dataOnly', sort: 2 },
          c: { sort: 3 }
        }
      }
    }
    expect(spellVariants(spell).map((v) => v.overlayId)).toEqual(['a'])
  })

  it.each([
    ['no overlays', { name: 'X', system: {} }],
    ['no system', { name: 'X' }],
    ['undefined', undefined],
    ['null', null]
  ])('returns an empty list for %s', (_label, spell) => {
    expect(spellVariants(spell)).toEqual([])
  })
})
