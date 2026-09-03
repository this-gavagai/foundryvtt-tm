import { describe, it, expect } from 'vitest'
import {
  attachDisplaced,
  recordOverlay,
  sourceFromEmbedded,
  type DisplacedValue,
  type StoredItem
} from '@/utils/itemSource'

// A +1 striking longsword as the wire payload carries one: source data from
// toObject(), with the Foundry side's display overlays applied on top.
//
// The two halves are built by the same code that runs in production — the
// overlay recorder — rather than by hand, so a change to how overlays are
// recorded cannot leave this fixture describing a payload the module no longer
// produces.
function longsword(): StoredItem {
  const item: Record<string, unknown> = {
    _id: 'sword-1',
    name: 'Longsword',
    type: 'weapon',
    img: 'icons/longsword.webp',
    sort: 400,
    _stats: { compendiumSource: 'Compendium.pf2e.equipment-srd.Item.abc' },
    flags: {
      pf2e: {
        grantedBy: { id: 'feat-1' },
        itemGrants: { boss: { id: 'boss-1' } },
        rulesSelections: { weapon: 'longsword' }
      }
    },
    system: {
      slug: 'longsword',
      quantity: 3,
      containerId: 'backpack-1',
      // Base values, as stored.
      level: { value: 4 },
      price: { value: { gp: 100 }, per: 1 },
      damage: { damageType: 'slashing', dice: 1, die: 'd8' },
      runes: { potency: 1, striking: 1, property: [] },
      material: { type: 'silver', grade: 'standard' },
      baseItem: 'longsword',
      category: 'martial',
      group: 'sword',
      rules: [{ key: 'FlatModifier', selector: 'attack', value: 1 }],
      subitems: [{ _id: 'boss-1', name: 'Shield Boss', type: 'weapon', system: {} }]
    }
  }

  // What characterDetails.ts does: overlay PF2e's prepared values.
  const displaced: DisplacedValue[] = []
  recordOverlay(item, displaced, 'system.level.value', 8) // rune-adjusted
  recordOverlay(item, displaced, 'system.price.value', { gp: 935 }) // rune-adjusted
  recordOverlay(item, displaced, 'system.stackGroup', null)
  recordOverlay(item, displaced, 'system.damage.damageType', 'piercing') // modular pick
  attachDisplaced(item, displaced)

  return item as StoredItem
}

describe('recordOverlay', () => {
  it('records what an overlay displaced, and applies the prepared value', () => {
    const item: Record<string, unknown> = { flags: {}, system: { level: { value: 4 } } }
    const displaced: DisplacedValue[] = []

    recordOverlay(item, displaced, 'system.level.value', 8)

    expect((item.system as { level: { value: number } }).level.value).toBe(8)
    expect(displaced).toEqual([{ path: 'system.level.value', had: true, value: 4 }])
  })

  it('records absence when the overlay fills in a field source never had', () => {
    const item: Record<string, unknown> = { flags: {}, system: { location: { value: 'entry-1' } } }
    const displaced: DisplacedValue[] = []

    recordOverlay(item, displaced, 'system.location.uses', { value: 1, max: 1 })

    expect(displaced).toEqual([{ path: 'system.location.uses', had: false }])
  })

  // The common case, and the reason the flag stays off most items: a plain
  // longsword's prepared level and price ARE its source level and price.
  it('records nothing when the prepared value equals the stored one', () => {
    const item: Record<string, unknown> = {
      flags: {},
      system: { level: { value: 0 }, price: { value: { gp: 1 } } }
    }
    const displaced: DisplacedValue[] = []

    recordOverlay(item, displaced, 'system.level.value', 0)
    recordOverlay(item, displaced, 'system.price.value', { gp: 1 })

    expect(displaced).toEqual([])
    attachDisplaced(item, displaced)
    expect(item.flags).toEqual({})
  })

  it('creates the intermediate objects a path needs', () => {
    const item: Record<string, unknown> = { flags: {} }
    const displaced: DisplacedValue[] = []

    recordOverlay(item, displaced, 'system.frequency', { value: 1, max: 1, per: 'day' })

    expect(item.system).toEqual({ frequency: { value: 1, max: 1, per: 'day' } })
    expect(displaced).toEqual([{ path: 'system.frequency', had: false }])
  })
})

describe('sourceFromEmbedded', () => {
  it('restores every display overlay to the value it displaced', () => {
    const source = sourceFromEmbedded(longsword())
    const system = source.system as Record<string, never>

    // The whole point of finding 2: a derived value persisted as source
    // changes what the item is. Level and price go back to base, and the
    // modular weapon's base damage type is slashing again — not the piercing
    // it happened to be set to when the sheet last rendered.
    expect((system.level as unknown as { value: number }).value).toBe(4)
    expect(system.price as unknown as object).toEqual({ value: { gp: 100 }, per: 1 })
    expect((system.damage as unknown as { damageType: string }).damageType).toBe('slashing')
  })

  // An innate spell: PF2e derives `location.uses` and never stores it, so the
  // restore has to REMOVE the key rather than write a null into it — while
  // leaving the rest of `location`, which is real source data, alone.
  it('removes a key the overlay filled in and source never had', () => {
    const item: Record<string, unknown> = {
      _id: 'spell-1',
      flags: {},
      system: { location: { value: 'entry-1' } }
    }
    const displaced: DisplacedValue[] = []
    recordOverlay(item, displaced, 'system.location.uses', { value: 1, max: 1 })
    attachDisplaced(item, displaced)

    const source = sourceFromEmbedded(item as StoredItem)

    expect(source.system).toEqual({ location: { value: 'entry-1' } })
  })

  it('drops the overlay record itself, and the flag scope when it empties', () => {
    const source = sourceFromEmbedded(longsword())

    expect(source.flags).not.toHaveProperty('tablemate')
  })

  it('leaves an unrelated tablemate flag in place', () => {
    const item: Record<string, unknown> = {
      _id: 'x',
      flags: { tablemate: { somethingElse: true } },
      system: {}
    }

    const source = sourceFromEmbedded(item as StoredItem)

    expect(source.flags).toEqual({ tablemate: { somethingElse: true } })
  })

  it('keeps everything a copy of the same item should keep', () => {
    const source = sourceFromEmbedded(longsword())
    const system = source.system as Record<string, unknown>

    // The fields finding 1 was silently dropping.
    expect(system.rules).toEqual([{ key: 'FlatModifier', selector: 'attack', value: 1 }])
    expect(system.runes).toEqual({ potency: 1, striking: 1, property: [] })
    expect(system.material).toEqual({ type: 'silver', grade: 'standard' })
    expect(system.baseItem).toBe('longsword')
    expect(system.category).toBe('martial')
    expect(system.group).toBe('sword')
    expect((system.damage as { dice: number; die: string }).dice).toBe(1)
    expect((system.damage as { dice: number; die: string }).die).toBe('d8')
    expect((source.flags as { pf2e: Record<string, unknown> }).pf2e.rulesSelections).toEqual({
      weapon: 'longsword'
    })
    // A split or a transfer genuinely IS the same item, so its origin pack and
    // its place in the sheet's ordering come along.
    expect(source._stats).toEqual({
      compendiumSource: 'Compendium.pf2e.equipment-srd.Item.abc'
    })
    expect(source.sort).toBe(400)
  })

  it('drops identity, relationships and attachments', () => {
    const source = sourceFromEmbedded(longsword())
    const pf2e = (source.flags as { pf2e: Record<string, unknown> }).pf2e

    expect(source).not.toHaveProperty('_id')
    // Attached items are documents in their own right; carrying one along would
    // conjure a second shield boss out of a split.
    expect(source.system).not.toHaveProperty('subitems')
    // A grant link belongs to the granted item, not to a copy of it — left in
    // place, utils/itemGrants reads it as a reason the copy can't be removed.
    expect(pf2e).not.toHaveProperty('grantedBy')
    expect(pf2e).not.toHaveProperty('itemGrants')
  })

  it('keeps the container on a same-actor split and drops it on a transfer', () => {
    const split = sourceFromEmbedded(longsword(), { quantity: 1 })
    const moved = sourceFromEmbedded(longsword(), { quantity: 1, toActor: true })

    expect((split.system as { containerId?: string }).containerId).toBe('backpack-1')
    expect(moved.system).not.toHaveProperty('containerId')
  })

  it('sets the requested quantity, and keeps the original without one', () => {
    expect(
      (sourceFromEmbedded(longsword(), { quantity: 2 }).system as { quantity: number }).quantity
    ).toBe(2)
    expect((sourceFromEmbedded(longsword()).system as { quantity: number }).quantity).toBe(3)
  })

  it('does not mutate the item it was given', () => {
    const item = longsword()

    sourceFromEmbedded(item, { quantity: 1, toActor: true })

    expect(item._id).toBe('sword-1')
    expect((item.system as { quantity: number }).quantity).toBe(3)
    // Still carrying the overlaid values the sheet reads.
    expect((item.system as { level: { value: number } }).level.value).toBe(8)
    expect((item.system as { subitems: unknown[] }).subitems).toHaveLength(1)
  })
})
