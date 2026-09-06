import { describe, it, expect } from 'vitest'
import { deriveItemValuation, displayedValuation } from '@/utils/itemValuation'

// PF2e recomputes an item's level and price from its runes, and the payload
// carries the STORED values without a GM. The numbers below are from the
// system's own tables and the divergences from a live table.
const item = (over: Record<string, unknown> = {}) =>
  ({
    type: 'weapon',
    system: { level: { value: 0 }, price: { value: { sp: 2 } }, ...over }
  }) as never

describe('items PF2e does not revalue', () => {
  // 207 of 225 physical items on the test table. The early exit in
  // computeLevelRarityPrice is why they were already right, and the risk here
  // is breaking them.
  it('passes a plain item straight through', () => {
    const plain = deriveItemValuation(item())
    expect(plain).toEqual({ level: 0, price: { sp: 2 }, provisional: false })
  })

  it('passes a specific magic item through, runes and all', () => {
    // PF2e exits before valuing anything when `specific` is set.
    const relic = item({ specific: true, runes: { potency: 2, striking: 2 } })
    expect(deriveItemValuation(relic).price).toEqual({ sp: 2 })
  })

  it('leaves an item with no runes alone even if it has an empty rune block', () => {
    expect(
      deriveItemValuation(item({ runes: { potency: 0, striking: 0, property: [] } })).level
    ).toBe(0)
  })
})

describe('fundamental runes', () => {
  // The live case: Yoon's Dagger, potency 1, source level 0 and price 2sp.
  it('values a +1 weapon at 35gp and level 2', () => {
    const dagger = deriveItemValuation(item({ runes: { potency: 1, property: [] } }))
    expect(dagger.level).toBe(2)
    expect(dagger.price).toEqual({ gp: 35 })
    expect(dagger.provisional).toBe(false)
  })

  // The base price is DISCARDED once a rune is present — not added to.
  it('replaces the base price rather than adding to it', () => {
    const pricey = item({ price: { value: { gp: 8 } }, runes: { potency: 1, property: [] } })
    expect(deriveItemValuation(pricey).price).toEqual({ gp: 35 })
  })

  it('sums potency and striking, and takes the higher level', () => {
    // +1 striking: 35 + 65 = 100gp, level max(2, 4) = 4.
    const sword = deriveItemValuation(item({ runes: { potency: 1, striking: 1, property: [] } }))
    expect(sword.price).toEqual({ gp: 100 })
    expect(sword.level).toBe(4)
  })

  it('uses the armour tables for armour, not the weapon ones', () => {
    const armor = deriveItemValuation({
      type: 'armor',
      system: { level: { value: 0 }, price: { value: {} }, runes: { potency: 1, resilient: 1 } }
    } as never)
    // Armour potency 160 + resilient 340; the weapon tables would say 35 + 65.
    expect(armor.price).toEqual({ gp: 500 })
    expect(armor.level).toBe(8)
  })

  it('ignores a rune that belongs to another item type', () => {
    // `resilient` is armour's; on a weapon it contributes nothing.
    const weapon = deriveItemValuation(item({ runes: { potency: 1, resilient: 3, property: [] } }))
    expect(weapon.price).toEqual({ gp: 35 })
  })

  it('keeps a stored price that is larger than the runes are worth', () => {
    const heirloom = deriveItemValuation(
      item({ price: { value: { gp: 900 } }, runes: { potency: 1, property: [] } })
    )
    expect(heirloom.price).toEqual({ gp: 900 })
  })
})

describe('what it refuses to value', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['property rune', { runes: { potency: 1, property: ['flaming'] } }],
    // One live actor carries `property` as an object with numeric keys.
    ['property rune as an object', { runes: { potency: 1, property: { 0: 'flaming' } } }],
    ['precious material', { material: { type: 'silver', grade: 'standard' } }],
    ['item grade', { grade: 'tactical' }],
    ['shoddy', { shoddy: true, runes: { potency: 1, property: [] } }],
    ['non-medium size', { size: 'lg', runes: { potency: 1, property: [] } }]
  ]
  for (const [name, over] of cases) {
    it(`reports ${name} as provisional and leaves the stored values`, () => {
      const result = deriveItemValuation(item(over))
      expect(result.provisional).toBe(true)
      expect(result.price).toEqual({ sp: 2 })
      expect(result.caveat).toBeTruthy()
    })
  }

  it('counts an empty object of property runes as none', () => {
    expect(deriveItemValuation(item({ runes: { potency: 1, property: {} } })).provisional).toBe(
      false
    )
  })
})

describe('deferring to PF2e where it has already answered', () => {
  // The gate: the Foundry side records an overlay whenever a prepared value
  // displaced a different stored one, so its presence means PF2e has valued
  // this item and its answer stands.
  it('keeps the payload’s valuation when an overlay was recorded', () => {
    const prepared = item({
      level: { value: 2 },
      price: { value: { pp: 0, gp: 35, sp: 0, cp: 0 } },
      runes: { potency: 1, property: [] }
    })
    const shown = displayedValuation(prepared, ['system.price.value', 'system.level.value'])
    expect(shown.price).toEqual({ pp: 0, gp: 35, sp: 0, cp: 0 })
    expect(shown.level).toBe(2)
  })

  it('derives when no overlay was recorded', () => {
    expect(displayedValuation(item({ runes: { potency: 1, property: [] } }), []).price).toEqual({
      gp: 35
    })
  })

  // A prepared item PF2e did not move records no overlay — and there is nothing
  // here to move either, so recomputing is a no-op. That is what lets one code
  // path serve both.
  it('is a no-op on a prepared item PF2e left alone', () => {
    const untouched = item({ price: { value: { pp: 0, gp: 0, sp: 2, cp: 0 } } })
    expect(displayedValuation(untouched, []).price).toEqual({ pp: 0, gp: 0, sp: 2, cp: 0 })
  })
})
