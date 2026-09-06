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

  // Corrects an earlier reading in this file. The first version of the
  // valuation kept the stored price when it exceeded the runes' worth, and a
  // test here asserted that. PF2e does not: `c` is zeroed outright the moment
  // any rune or material value exists, so the comparison that follows is
  // against zero and the base price is always discarded. The live table could
  // not settle it — every runed item there is worth more than its stored price
  // either way — so this one is pinned to the system's code.
  it('discards the stored price entirely once a rune is present', () => {
    const heirloom = deriveItemValuation(
      item({ price: { value: { gp: 900 } }, runes: { potency: 1, property: [] } })
    )
    expect(heirloom.price).toEqual({ gp: 35 })
  })
})

describe('what the transcribed tables buy', () => {
  // GROUND TRUTH, from the live table: Seoni's Mentalist's Staff carries a +1
  // potency, a greater striking and a flaming rune, and PF2e values it at level
  // 12 for 1600gp. 35 + 1065 + 500 is exactly that, which is what says the
  // transcription is right and not merely plausible.
  it('values a property rune, matching PF2e on a real item', () => {
    const staff = item({
      level: { value: 4 },
      runes: { potency: 1, striking: 2, property: ['flaming'] }
    })
    const valued = deriveItemValuation(staff)
    expect(valued.price).toEqual({ gp: 1600 })
    expect(valued.level).toBe(12)
    expect(valued.provisional).toBe(false)
  })

  it('takes the worst rarity across runes and material', () => {
    // ancestralEchoing is rare; a common weapon carrying it becomes rare.
    const axe = item({ runes: { potency: 1, property: ['ancestralEchoing'] } })
    expect(deriveItemValuation(axe).rarity).toBe('rare')
  })

  it('values a precious material, scaled by Bulk', () => {
    // PF2e charges material + Bulk/10 of it, so a 2-Bulk item pays 1.2x.
    const silvered = item({
      bulk: { heldOrStowed: 2 },
      material: { type: 'silver', grade: 'standard' }
    })
    const valued = deriveItemValuation(silvered)
    expect(valued.provisional).toBe(false)
    expect(valued.price?.gp).toBeGreaterThan(0)
  })

  it('values an item grade', () => {
    const graded = item({ grade: 'tactical' })
    const valued = deriveItemValuation(graded)
    expect(valued.provisional).toBe(false)
    expect(valued.level).toBeGreaterThan(0)
  })

  it('halves a shoddy item', () => {
    const shoddy = item({
      traits: { otherTags: ['shoddy'], value: [] },
      runes: { potency: 1 }
    })
    // 35gp for the potency rune, halved.
    expect(deriveItemValuation(shoddy).price).toEqual({ gp: 17.5 })
  })

  it('scales a size-sensitive price by item size', () => {
    const large = item({ size: 'lg', runes: { potency: 1 } })
    expect(deriveItemValuation(large).price).toEqual({ gp: 70 })
  })

  it('leaves a size-insensitive price alone', () => {
    const large = item({
      size: 'lg',
      price: { value: { gp: 10 }, sizeSensitive: false },
      runes: { potency: 1 }
    })
    expect(deriveItemValuation(large).price).toEqual({ gp: 35 })
  })

  it('falls back to the stored price for a rune it has never heard of', () => {
    // A rune from a book published after these tables were transcribed. It
    // contributes nothing rather than being guessed at — see the warning at the
    // top of pf2eValuationTables.
    const future = item({ runes: { potency: 1, property: ['runeFromABookNotYetWritten'] } })
    expect(deriveItemValuation(future).price).toEqual({ gp: 35 })
  })

  it('reads property runes stored as an object with numeric keys', () => {
    const odd = item({ runes: { potency: 1, striking: 2, property: { 0: 'flaming' } } })
    expect(deriveItemValuation(odd).price).toEqual({ gp: 1600 })
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
