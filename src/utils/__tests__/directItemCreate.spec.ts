import { describe, it, expect } from 'vitest'
import { checkDirectAdd, normalizeDirectItemSource } from '@/utils/directItemCreate'

// Which compendium items can be added with no GM, and what has to be normalised
// when they are.
//
// The stakes are asymmetric, which is why the test is a positive allowlist and
// so are these cases. Refusing an eligible item costs a player a convenience.
// ADMITTING an ineligible one creates it while skipping work PF2e would have
// done — a feat without the items it grants, a kit that never unpacked, an
// ancestry that never adjusted hit points — and the create SUCCEEDS, so nothing
// anywhere reports it. Every "not eligible" case below is one of those.

const src = (type: string, rules?: unknown[], system: Record<string, unknown> = {}) => ({
  type,
  system: { ...(rules === undefined ? {} : { rules }), ...system }
})

describe('checkDirectAdd', () => {
  // The point of the whole path: mundane gear, which the pipeline does nothing
  // for. Verified against pf2e 8.4.1 — none of these types declares its own
  // _preCreate.
  it.each(['weapon', 'armor', 'shield', 'consumable', 'equipment', 'treasure', 'backpack'])(
    'admits a rules-free %s',
    (type) => {
      expect(checkDirectAdd(src(type, []))).toEqual({ eligible: true })
    }
  )

  it('treats a missing rules array as no rules', () => {
    expect(checkDirectAdd({ type: 'equipment', system: {} })).toEqual({ eligible: true })
    expect(checkDirectAdd({ type: 'equipment' })).toEqual({ eligible: true })
  })

  // ANY rule, not a blocklist of the troublesome ones. Seven rule-element types
  // do work at creation time; a blocklist of two would wave five through.
  it('refuses an item carrying any rule at all', () => {
    expect(checkDirectAdd(src('equipment', [{ key: 'FlatModifier' }]))).toEqual({
      eligible: false,
      reason: 'has-rules'
    })
    // Even one that looks harmless in isolation.
    expect(checkDirectAdd(src('weapon', [{ key: 'TokenImage' }]))).toEqual({
      eligible: false,
      reason: 'has-rules'
    })
  })

  // Creation runs a hit-point recalculation off a clone of the actor
  // (ItemPF2e#_preCreate), so these can never be created directly.
  it.each(['ancestry', 'background', 'class', 'feat', 'heritage'])(
    'refuses %s as character-building, even with no rules',
    (type) => {
      expect(checkDirectAdd(src(type, []))).toEqual({
        eligible: false,
        reason: 'character-building'
      })
    }
  )

  // A kit is not stored at all — the pipeline expands it into its contents and
  // drops the kit itself. A direct create would store the wrapper and none of
  // the gear.
  it('refuses a kit', () => {
    expect(checkDirectAdd(src('kit', []))).toEqual({ eligible: false, reason: 'is-kit' })
  })

  // Ammunition and spells declare their own _preCreate; everything else is
  // outside the verified set.
  it.each(['ammo', 'spell', 'action', 'effect', 'condition', 'spellcastingEntry', 'lore'])(
    'refuses %s as needing the system',
    (type) => {
      expect(checkDirectAdd(src(type, []))).toEqual({ eligible: false, reason: 'needs-system' })
    }
  )

  it('refuses a source with no usable type rather than guessing', () => {
    expect(checkDirectAdd({}).eligible).toBe(false)
    expect(checkDirectAdd(null).eligible).toBe(false)
    expect(checkDirectAdd(undefined).eligible).toBe(false)
    expect(checkDirectAdd({ type: 42 } as never).eligible).toBe(false)
  })
})

// The three things PF2e's _preCreate does that apply to an eligible item being
// parented to an actor. Replicated rather than skipped, so an item added
// without the GM is byte-for-byte what the pipeline would have stored.
describe('normalizeDirectItemSource', () => {
  it('clears a container id that is not a real 16-character id', () => {
    const source = normalizeDirectItemSource({ system: { containerId: 'nope' } })
    expect((source.system as { containerId: unknown }).containerId).toBeNull()
  })

  it('clears an absent container id to null rather than leaving it undefined', () => {
    const source = normalizeDirectItemSource({ system: {} })
    expect((source.system as { containerId: unknown }).containerId).toBeNull()
  })

  it('keeps a real 16-character container id', () => {
    const id = 'abcdefghij123456'
    const source = normalizeDirectItemSource({ system: { containerId: id } })
    expect((source.system as { containerId: unknown }).containerId).toBe(id)
  })

  // A selection authored into the pack would claim this item is the
  // character's chosen apex item.
  it('drops an apex selection', () => {
    const source = normalizeDirectItemSource({
      system: { apex: { attribute: 'str', selected: true } }
    })
    expect((source.system as { apex: Record<string, unknown> }).apex).toEqual({ attribute: 'str' })
  })

  it('leaves an item with no apex block alone', () => {
    expect(() => normalizeDirectItemSource({ system: {} })).not.toThrow()
  })

  // Cosmetic — it decides the order trait pills render in — but a mismatch
  // would show as the same item reading differently depending on how it was
  // added.
  it('sorts the source traits, as ItemPF2e#_preCreate does', () => {
    const source = normalizeDirectItemSource({
      system: { traits: { value: ['versatile-s', 'agile', 'finesse'] } }
    })
    expect((source.system as { traits: { value: string[] } }).traits.value).toEqual([
      'agile',
      'finesse',
      'versatile-s'
    ])
  })

  it('creates a system block for a source that somehow has none', () => {
    const source = normalizeDirectItemSource({})
    expect(source.system).toEqual({ containerId: null })
  })

  it('leaves everything else untouched', () => {
    const source = normalizeDirectItemSource({
      name: 'Longsword',
      type: 'weapon',
      _stats: { compendiumSource: 'Compendium.pf2e.equipment-srd.Item.abc' },
      system: { quantity: 1, runes: { potency: 1 }, damage: { dice: 1, die: 'd8' } }
    })
    expect(source.name).toBe('Longsword')
    expect(source._stats).toEqual({
      compendiumSource: 'Compendium.pf2e.equipment-srd.Item.abc'
    })
    const system = source.system as Record<string, unknown>
    expect(system.quantity).toBe(1)
    expect(system.runes).toEqual({ potency: 1 })
    expect(system.damage).toEqual({ dice: 1, die: 'd8' })
  })
})

// The modal asks this about the DISPLAY payload it already holds rather than
// paying for a second pack read, so the check has to accept that shape too —
// shapeCompendiumItem spreads the whole `system`, so `rules` and `type` are
// both on it, but its declared type names its own fields.
describe('the display payload', () => {
  it('is accepted, and read the same way as a raw source', () => {
    const displayShaped = {
      _id: 'abc',
      name: 'Longsword',
      type: 'weapon',
      source: 'Equipment',
      system: {
        description: { value: '<p>A sword.</p>' },
        traits: { value: ['versatile-p'], rarity: 'common' },
        level: { value: 0 },
        rules: []
      }
    }
    expect(checkDirectAdd(displayShaped)).toEqual({ eligible: true })

    expect(
      checkDirectAdd({
        ...displayShaped,
        system: { ...displayShaped.system, rules: [{ key: 'GrantItem' }] }
      })
    ).toEqual({
      eligible: false,
      reason: 'has-rules'
    })
  })
})
