import { describe, it, expect } from 'vitest'
import { stackableWith, stackCandidateIds, type StackableItem } from '@/utils/itemStacks'

// Ports of pf2e 8.4.1's PhysicalItemPF2e#isStackableWith (plus the Armor,
// Shield and Container overrides) are only worth having if they say the same
// thing the system says. Each case here is one clause of that method.

function item(overrides: Record<string, unknown> = {}): StackableItem {
  const { system, ...rest } = overrides as { system?: Record<string, unknown> }
  return {
    _id: 'a',
    name: 'Arrows',
    type: 'consumable',
    system: {
      quantity: 10,
      uses: { value: 1, max: 1 },
      identification: { status: 'identified' },
      equipped: { carryType: 'stowed', handsHeld: 0, inSlot: false },
      containerId: null,
      price: { value: { cp: 1 }, per: 10 },
      traits: { value: [], rarity: 'common' },
      ...system
    },
    ...rest
  }
}

const pair = (a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) =>
  [item({ _id: 'a', ...a }), item({ _id: 'b', ...b })] as const

describe('stackableWith', () => {
  it('stacks two identical loose stacks', () => {
    const [a, b] = pair()
    expect(stackableWith(a, b)).toBe(true)
  })

  it('never stacks an item with itself', () => {
    const a = item()
    expect(stackableWith(a, a)).toBe(false)
    expect(stackableWith(item({ _id: 'a' }), item({ _id: 'a' }))).toBe(false)
  })

  it.each([
    ['name', { name: 'Bolts' }],
    ['type', { type: 'equipment' }]
  ])('refuses a different %s', (_label, difference) => {
    const [a, b] = pair({}, difference)
    expect(stackableWith(a, b)).toBe(false)
  })

  // The whole reason this file compares system data rather than names: PF2e
  // leaves an item's name alone when runes are added, so a runed weapon and a
  // plain one of the same base type are two rows with identical names.
  it('refuses items that differ anywhere in their system data', () => {
    const [a, b] = pair(
      { type: 'weapon', name: 'Longsword', system: { runes: { potency: 1, striking: 1 } } },
      { type: 'weapon', name: 'Longsword', system: { runes: { potency: 0, striking: 0 } } }
    )
    expect(stackableWith(a, b)).toBe(false)
  })

  it('ignores the fields two members of a stack may differ in', () => {
    const [a, b] = pair(
      {
        system: {
          quantity: 3,
          containerId: 'backpack-1',
          equipped: { carryType: 'stowed', handsHeld: 0, inSlot: true },
          identification: { status: 'identified', unidentified: { name: 'Arrow?' } },
          publication: { title: 'Player Core' },
          _migration: { version: 0.9 }
        }
      },
      {
        system: {
          quantity: 40,
          containerId: null,
          equipped: { carryType: 'worn', handsHeld: 0, inSlot: false },
          identification: { status: 'identified' },
          publication: { title: 'Core Rulebook' },
          _migration: { version: 0.93 }
        }
      }
    )
    expect(stackableWith(a, b)).toBe(true)
  })

  it('reads price in copper, so the same price written two ways still stacks', () => {
    const [a, b] = pair(
      { system: { price: { value: { gp: 1 }, per: 1 } } },
      { system: { price: { value: { sp: 10 }, per: 1 } } }
    )
    expect(stackableWith(a, b)).toBe(true)
  })

  it('refuses when one is identified and the other is not', () => {
    const [a, b] = pair({}, { system: { identification: { status: 'unidentified' } } })
    expect(stackableWith(a, b)).toBe(false)
  })

  it('refuses a destination with charges partly spent', () => {
    const [a, b] = pair(
      { system: { uses: { value: 3, max: 3 } } },
      { system: { uses: { value: 1, max: 3 } } }
    )
    expect(stackableWith(a, b)).toBe(false)
  })

  it('refuses credstick treasure, which carries a balance', () => {
    const [a, b] = pair(
      { type: 'treasure', system: { category: 'credstick' } },
      { type: 'treasure', system: { category: 'credstick' } }
    )
    expect(stackableWith(a, b)).toBe(false)
  })

  it('never stacks containers, however identical', () => {
    const [a, b] = pair({ type: 'backpack' }, { type: 'backpack' })
    expect(stackableWith(a, b)).toBe(false)
  })

  it('refuses armor while either copy is worn in its slot', () => {
    const worn = { carryType: 'worn', handsHeld: 0, inSlot: true }
    const stowed = { carryType: 'stowed', handsHeld: 0, inSlot: false }
    const armor = (equipped: Record<string, unknown>, id: string) =>
      item({ _id: id, type: 'armor', name: 'Chain Shirt', system: { equipped } })

    expect(stackableWith(armor(worn, 'a'), armor(stowed, 'b'))).toBe(false)
    expect(stackableWith(armor(stowed, 'a'), armor(worn, 'b'))).toBe(false)
    expect(stackableWith(armor(stowed, 'a'), armor(stowed, 'b'))).toBe(true)
  })

  it('requires held-ness to match, and refuses two non-empty stacks in hand', () => {
    const held = { carryType: 'held', handsHeld: 1, inSlot: false }
    const stowed = { carryType: 'stowed', handsHeld: 0, inSlot: false }

    expect(
      stackableWith(...pair({ system: { equipped: held } }, { system: { equipped: stowed } }))
    ).toBe(false)
    expect(
      stackableWith(...pair({ system: { equipped: held } }, { system: { equipped: held } }))
    ).toBe(false)
    // One of them empty is the case PF2e does allow: nothing is in that hand.
    expect(
      stackableWith(
        ...pair(
          { system: { equipped: held, quantity: 0 } },
          { system: { equipped: held, quantity: 5 } }
        )
      )
    ).toBe(true)
  })

  // The held rule is skipped entirely for a stowed source, which is how a stack
  // in a backpack can merge into one that's in hand.
  it('skips the held rule when the source sits in a container', () => {
    const [a, b] = pair(
      { system: { containerId: 'backpack-1' } },
      { system: { equipped: { carryType: 'held', handsHeld: 1, inSlot: false } } }
    )
    expect(stackableWith(a, b)).toBe(true)
  })
})

describe('stackCandidateIds', () => {
  it('lists every stackable item and nothing else', () => {
    const destination = item({ _id: 'dest' })
    const items = [
      destination,
      item({ _id: 'same' }),
      item({ _id: 'also-same', system: { quantity: 2, containerId: 'backpack-1' } }),
      item({ _id: 'other', name: 'Bolts' })
    ]
    expect(stackCandidateIds(items, destination)).toEqual(['same', 'also-same'])
  })

  it('answers an empty inventory', () => {
    expect(stackCandidateIds(undefined, item())).toEqual([])
  })
})
