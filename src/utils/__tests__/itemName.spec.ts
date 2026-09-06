import { describe, it, expect } from 'vitest'
import { composeItemName } from '@/utils/itemName'

// The catalog the Foundry side publishes, trimmed to what these need. Keys and
// values are the real ones — `+{potency} {fundamental2} {base}` is PF2e's own
// template, not a paraphrase.
const parts: Record<string, string> = {
  'weapon-base-longsword': 'Longsword',
  'weapon-base-longbow': 'Longbow',
  'weapon-base-staff': 'Staff',
  'armor-base-half-plate': 'Half Plate',
  'shield-base-steel-shield': 'Steel Shield',
  'striking-1': 'Striking',
  'striking-2': 'Greater Striking',
  'resilient-1': 'Resilient',
  'reinforcing-1': 'Minor Reinforcing',
  'rune-flaming': 'Flaming',
  'material-silver': 'Silver',
  'grade-tactical': 'Tactical',
  'format-Potency': '+{potency} {base}',
  'format-PotencyFundamental2': '+{potency} {fundamental2} {base}',
  'format-PotencyFundamental2OneProperty': '+{potency} {fundamental2} {property1} {base}',
  'format-OneProperty': '{property1} {base}',
  'format-PotencyMaterial': '+{potency} {material} {base}',
  'format-Reinforcing': '{reinforcing} {base}',
  'format-Grade': '{grade} {base}',
  'format-GradeMaterial': '{grade} {material} {base}'
}

const weapon = (name: string, base: string, over: Record<string, unknown> = {}) =>
  ({ _id: 'x', name, type: 'weapon', system: { baseItem: base, runes: {}, ...over } }) as never

describe('composing an item name', () => {
  // Both verified against the live payload's own label map.
  it('names a +1 striking longsword', () => {
    const it = weapon('Longsword', 'longsword', { runes: { potency: 1, striking: 1 } })
    expect(composeItemName(it, parts)).toBe('+1 Striking Longsword')
  })

  it('names a +1 longbow, with no second fundamental', () => {
    const it = weapon('Longbow', 'longbow', { runes: { potency: 1, striking: 0 } })
    expect(composeItemName(it, parts)).toBe('+1 Longbow')
  })

  it('includes a property rune', () => {
    const it = weapon('Longsword', 'longsword', {
      runes: { potency: 1, striking: 1, property: ['flaming'] }
    })
    expect(composeItemName(it, parts)).toBe('+1 Striking Flaming Longsword')
  })

  it('leaves a plain weapon alone', () => {
    expect(composeItemName(weapon('Longsword', 'longsword'), parts)).toBe('Longsword')
  })
})

// The guard is the load-bearing part: it is why the property-rune table barely
// matters, and why nothing a book named ever gets rewritten.
describe('what it refuses to rename', () => {
  it('leaves an item whose stored name is not the base type', () => {
    // Live case: Seoni's Mentalist's Staff, +1 greater striking flaming, which
    // PF2e does NOT rename.
    const staff = weapon("Mentalist's Staff", 'staff', {
      runes: { potency: 1, striking: 2, property: ['flaming'] }
    })
    expect(composeItemName(staff, parts)).toBe("Mentalist's Staff")
  })

  it('leaves a specific magic item', () => {
    // Live case: Seoni's Icicle. `specific` arrives as an OBJECT, not a boolean.
    const icicle = weapon('Icicle', 'longspear', {
      specific: { runes: { potency: 2 } },
      runes: { potency: 2, striking: 2, property: ['greaterFrost'] }
    })
    expect(composeItemName(icicle, parts)).toBe('Icicle')
  })

  it('leaves an item with no base type', () => {
    const staff = weapon('Staff of Fire', null as never, { runes: { potency: 1, striking: 1 } })
    expect(composeItemName(staff, parts)).toBe('Staff of Fire')
  })

  it('leaves anything that is not a weapon, armour or shield', () => {
    const potion = { _id: 'p', name: 'Healing Potion', type: 'consumable', system: {} } as never
    expect(composeItemName(potion, parts)).toBe('Healing Potion')
  })

  // An older module publishes no itemNames at all; the sheet must degrade to
  // exactly what it showed before this existed.
  it('falls back to the stored name with no catalog', () => {
    const it = weapon('Longsword', 'longsword', { runes: { potency: 1, striking: 1 } })
    expect(composeItemName(it, undefined)).toBe('Longsword')
    expect(composeItemName(it, {})).toBe('Longsword')
  })

  it('falls back when this arrangement has no template', () => {
    // Potency + reinforcing has no `format-PotencyReinforcing` here.
    const shield = {
      _id: 's',
      name: 'Steel Shield',
      type: 'shield',
      system: { baseItem: 'steel-shield', runes: { potency: 1, reinforcing: 1 } }
    } as never
    expect(composeItemName(shield, parts)).toBe('Steel Shield')
  })
})

describe('the other arrangements', () => {
  it('uses armour’s resilient rune as the second fundamental', () => {
    const armor = {
      _id: 'a',
      name: 'Half Plate',
      type: 'armor',
      system: { baseItem: 'half-plate', runes: { potency: 1, resilient: 1, striking: 3 } }
    } as never
    // `striking` on armour must be ignored in favour of `resilient`.
    expect(composeItemName(armor, parts)).toBe('+1 Resilient Half Plate')
  })

  it('names a reinforced shield', () => {
    const shield = {
      _id: 's',
      name: 'Steel Shield',
      type: 'shield',
      system: { baseItem: 'steel-shield', runes: { reinforcing: 1 } }
    } as never
    expect(composeItemName(shield, parts)).toBe('Minor Reinforcing Steel Shield')
  })

  it('takes a precious material', () => {
    const it = weapon('Longsword', 'longsword', {
      runes: { potency: 1 },
      material: { type: 'silver' }
    })
    expect(composeItemName(it, parts)).toBe('+1 Silver Longsword')
  })

  it('gives a grade its own template, excluding the runes', () => {
    const it = weapon('Longsword', 'longsword', { grade: 'tactical', runes: { potency: 1 } })
    expect(composeItemName(it, parts)).toBe('Tactical Longsword')
  })

  it('reads property runes stored as an object with numeric keys', () => {
    const it = weapon('Longsword', 'longsword', {
      runes: { potency: 1, striking: 1, property: { 0: 'flaming' } }
    })
    expect(composeItemName(it, parts)).toBe('+1 Striking Flaming Longsword')
  })
})
