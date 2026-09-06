import { describe, it, expect } from 'vitest'
import {
  Bulk,
  computeTotalBulk,
  bulkPerOf,
  containerCapacity,
  inventoryBulk,
  stackGroupOf,
  type BulkItem
} from '@/utils/bulk'

// Pinned against pf2e 8.4.1's `Bulk` and `InventoryBulk`. Bulk is the one
// Tier-2 figure with no rule elements in its way, so these are exactness tests,
// not approximation tests.

let nextId = 0
function item(over: Partial<BulkItem['system']> & { type?: string; _id?: string } = {}): BulkItem {
  const { type, _id, ...system } = over
  return {
    _id: _id ?? `item-${nextId++}`,
    type: type ?? 'equipment',
    system: { quantity: 1, bulk: { value: 1 }, ...system }
  }
}

describe('Bulk arithmetic', () => {
  it('splits whole Bulk from light', () => {
    expect([new Bulk(2.3).normal, new Bulk(2.3).light]).toEqual([2, 3])
    expect(new Bulk(0.6).toLightUnits()).toBe(6)
    expect(new Bulk(2.3).toLightUnits()).toBe(23)
  })

  it('rounds to a tenth so repeated addition does not drift', () => {
    // Ten light items summed one at a time land on 0.9999… in float. PF2e rounds
    // at construction, so this must read 1 Bulk and not 9 light.
    let sum = new Bulk()
    for (let i = 0; i < 10; i++) sum = sum.plus(0.1)
    expect(sum.normal).toBe(1)
    expect(sum.light).toBe(0)
  })

  it('never goes negative', () => {
    expect(new Bulk(1).minus(5).value).toBe(0)
  })

  it('doubles by PF2e’s rule, not by multiplication', () => {
    // Negligible → light, light → 1 Bulk. Plain ×2 would leave both at zero and
    // one-tenth, which is the whole point of the special cases.
    expect(new Bulk(0).double().value).toBe(0.1)
    expect(new Bulk(0.5).double().value).toBe(1)
    expect(new Bulk(2).double().value).toBe(4)
  })
})

describe('size conversion', () => {
  it('is identity at the same size, and treats small as medium', () => {
    expect(new Bulk(2).convertToSize('med', 'med').value).toBe(2)
    expect(new Bulk(2).convertToSize('sm', 'med').value).toBe(2)
    expect(new Bulk(2).convertToSize('med', 'sm').value).toBe(2)
  })

  it('doubles once per step down the ladder', () => {
    expect(new Bulk(1).convertToSize('lg', 'med').value).toBe(2)
    expect(new Bulk(1).convertToSize('huge', 'med').value).toBe(4)
  })

  it('collapses rather than halving on the way up', () => {
    // A medium item carried by a large creature: 1 Bulk becomes light, light
    // becomes negligible. Halving only starts above 1 Bulk.
    expect(new Bulk(1).convertToSize('med', 'lg').value).toBe(0.1)
    expect(new Bulk(0.1).convertToSize('med', 'lg').value).toBe(0)
    expect(new Bulk(4).convertToSize('med', 'lg').value).toBe(2)
  })
})

describe('stack grouping', () => {
  it('weighs a stack by whole units of `per`', () => {
    // Arrows are 1 Bulk per 10. Nine weigh nothing.
    const arrows = item({ bulk: { value: 1, per: 10 }, quantity: 9, baseItem: 'arrows' })
    expect(computeTotalBulk([arrows], [arrows], 'med').value).toBe(0)
  })

  it('combines quantities across stacks of the same base item', () => {
    // The reason grouping exists: two quivers of five arrows are ten arrows.
    const a = item({ bulk: { value: 1, per: 10 }, quantity: 5, baseItem: 'arrows' })
    const b = item({ bulk: { value: 1, per: 10 }, quantity: 5, baseItem: 'arrows' })
    expect(computeTotalBulk([a, b], [a, b], 'med').value).toBe(1)
  })

  it('keeps different base items in separate groups', () => {
    const arrows = item({ bulk: { value: 1, per: 10 }, quantity: 5, baseItem: 'arrows' })
    const bolts = item({ bulk: { value: 1, per: 10 }, quantity: 5, baseItem: 'bolts' })
    expect(computeTotalBulk([arrows, bolts], [arrows, bolts], 'med').value).toBe(0)
  })
})

describe('containers', () => {
  it('negates the Bulk its capacity allows', () => {
    // A backpack: 1 Bulk itself, ignores the first 2 Bulk of what it holds.
    const pack = item({
      _id: 'pack',
      type: 'backpack',
      bulk: { value: 1, capacity: 4, ignored: 2 },
      stowing: true,
      baseItem: 'backpack'
    })
    const stowed = item({ containerId: 'pack', bulk: { value: 2 } })
    const all = [pack, stowed]
    // 1 (pack) + 2 (contents) − 2 (ignored) = 1
    expect(computeTotalBulk([pack], all, 'med').value).toBe(1)
  })

  it('stops negating once it is over capacity', () => {
    const pack = item({
      _id: 'pack',
      type: 'backpack',
      bulk: { value: 1, capacity: 2, ignored: 2 },
      stowing: true,
      baseItem: 'backpack'
    })
    const stowed = item({ containerId: 'pack', bulk: { value: 5 } })
    const all = [pack, stowed]
    expect(containerCapacity(pack, all, 'med').percentFull).toBeGreaterThan(100)
    // 1 + 5 − 0 = 6: the negation has lapsed.
    expect(computeTotalBulk([pack], all, 'med').value).toBe(6)
  })

  it('stops negating for an extradimensional container inside another', () => {
    const outer = item({
      _id: 'outer',
      type: 'backpack',
      bulk: { value: 1, capacity: 10, ignored: 2 },
      stowing: true,
      baseItem: 'backpack'
    })
    const inner = item({
      _id: 'inner',
      type: 'backpack',
      containerId: 'outer',
      bulk: { value: 1, capacity: 10, ignored: 2 },
      stowing: true,
      baseItem: 'bag-of-holding',
      traits: { value: ['extradimensional'] }
    })
    const all = [outer, inner]
    expect(containerCapacity(inner, all, 'med').ignored.value).toBe(0)
  })

  it('flattens a container that does not stow', () => {
    // A sheath holds a weapon but is not a bag: PF2e counts the contents against
    // the wearer directly and the sheath itself disappears from the sum.
    const sheath = item({
      _id: 'sheath',
      type: 'backpack',
      bulk: { value: 1, capacity: 1, ignored: 1 },
      stowing: false,
      baseItem: 'sheath'
    })
    const blade = item({ containerId: 'sheath', bulk: { value: 1 }, baseItem: 'dagger' })
    const all = [sheath, blade]
    expect(computeTotalBulk([sheath], all, 'med').value).toBe(1)
  })
})

describe('the actor readout', () => {
  it('uses 10 + Str for the maximum and 5 + Str for encumbrance', () => {
    const result = inventoryBulk([], 4, 'med')
    expect(result.max).toBe(14)
    expect(result.encumberedAfter).toBe(9)
  })

  it('counts only what is not already inside a container', () => {
    // Contained items reach the total through their container's own Bulk; adding
    // them again at the top level would double-count everything stowed.
    const pack = item({
      _id: 'pack',
      type: 'backpack',
      bulk: { value: 1, capacity: 4, ignored: 2 },
      stowing: true,
      baseItem: 'backpack'
    })
    const stowed = item({ containerId: 'pack', bulk: { value: 2 } })
    expect(inventoryBulk([pack, stowed], 0, 'med').value.value).toBe(1)
  })

  it('flags encumbrance and overload on whole Bulk only', () => {
    const heavy = item({ bulk: { value: 6 }, baseItem: 'anvil' })
    const result = inventoryBulk([heavy], 0, 'med')
    expect(result.value.normal).toBe(6)
    expect(result.isEncumbered).toBe(true)
    expect(result.isOverMax).toBe(false)
  })

  it('takes rule-element addends when a payload has supplied them', () => {
    // The one place a rule element reaches this figure: ActiveEffectLike writing
    // inventory.bulk.maxAddend. Source cannot see it, so it is passed in.
    const result = inventoryBulk([], 2, 'med', { max: 3, encumberedAfter: 3 })
    expect(result.max).toBe(15)
    expect(result.encumberedAfter).toBe(10)
  })
})

// The stack group is not stored for two whole item types — PF2e computes it in
// a getter for treasure and at prepare time for ammunition — so a sheet painted
// from source alone had no `per` at all. Without `per` a stack weighs its full
// quoted Bulk EACH, which is the difference between a coin purse weighing
// nothing and weighing half a tonne.
describe('the stack group, where PF2e does not store one', () => {
  const item = (over: Record<string, unknown>) =>
    ({ _id: 'x', ...over }) as unknown as Parameters<typeof stackGroupOf>[0]

  it('reads a coin purse as coins, a thousand to the Bulk', () => {
    const coins = item({ type: 'treasure', system: { category: 'coin', slug: 'gold-pieces' } })
    expect(stackGroupOf(coins)).toBe('coins')
    expect(bulkPerOf(coins)).toBe(1000)
  })

  it('reads gems and universal polymer base', () => {
    expect(bulkPerOf(item({ type: 'treasure', system: { category: 'gem' } }))).toBe(2000)
    expect(bulkPerOf(item({ type: 'treasure', system: { slug: 'upb' } }))).toBe(1000)
  })

  it('leaves other treasure stacking singly', () => {
    const art = item({ type: 'treasure', system: { category: 'art-object' } })
    expect(stackGroupOf(art)).toBeNull()
    expect(bulkPerOf(art)).toBe(1)
  })

  it('reads ammunition from its base item', () => {
    // Verified against a live character: 20 bolts arrive with no stackGroup in
    // source and `{value: 0.1, per: 10}` once PF2e has prepared them.
    expect(bulkPerOf(item({ type: 'ammo', system: { baseItem: 'bolts' } }))).toBe(10)
    expect(bulkPerOf(item({ type: 'ammo', system: { baseItem: 'sling-bullets' } }))).toBe(10)
    expect(bulkPerOf(item({ type: 'ammo', system: { baseItem: 'rounds' } }))).toBe(10)
  })

  it('stacks unrecognised ammunition singly rather than guessing', () => {
    expect(bulkPerOf(item({ type: 'ammo', system: { baseItem: 'something-homebrew' } }))).toBe(1)
  })

  it('takes a consumable’s stored stack group, which IS source', () => {
    expect(bulkPerOf(item({ type: 'consumable', system: { stackGroup: 'arrows' } }))).toBe(10)
    expect(bulkPerOf(item({ type: 'consumable', system: { stackGroup: null } }))).toBe(1)
  })
})

describe('bulk with a derived stack group', () => {
  // The failure this closes, at the size it actually occurred.
  it('weighs 509 silver pieces as nothing, not as 509 Bulk', () => {
    const coins = {
      _id: 'c',
      type: 'treasure',
      system: { category: 'coin', slug: 'silver-pieces', quantity: 509, bulk: { value: 1 } }
    }
    expect(computeTotalBulk([coins] as never, [coins] as never, 'med').value).toBe(0)
  })

  it('still prefers a `per` the payload supplied', () => {
    const odd = {
      _id: 'c',
      type: 'treasure',
      system: { category: 'coin', quantity: 100, bulk: { value: 1, per: 50 } }
    }
    expect(computeTotalBulk([odd] as never, [odd] as never, 'med').value).toBe(2)
  })
})

// PF2e accepts a `containerId` only when it names a backpack in the same
// inventory that is not the item itself; anything else leaves the item at the
// top level. Reading the id as "stowed, therefore not my problem" dropped such
// an item out of the carried list AND out of every container's contents, so it
// weighed nothing anywhere — a total quietly too small, with nothing to see.
describe('a containerId that does not resolve', () => {
  const pack = { _id: 'pack', type: 'backpack', system: { bulk: { value: 0, capacity: 4 } } }
  const elixir = (containerId: string | null) => ({
    _id: 'elixir',
    type: 'consumable',
    system: { quantity: 1, bulk: { value: 0.1 }, containerId }
  })

  it('carries an item whose container is gone', () => {
    // The live case: an Elixir of Life pointing at a container that no longer
    // exists, and a character 0.1 Bulk light for it.
    const items = [pack, elixir('deleted-container')]
    expect(inventoryBulk(items as never, 0, 'med').value.value).toBe(0.1)
  })

  it('still stows it when the container is there', () => {
    const items = [pack, elixir('pack')]
    // Inside a backpack that ignores nothing, so the Bulk still tells.
    expect(inventoryBulk(items as never, 0, 'med').value.value).toBe(0.1)
    expect(containerCapacity(pack as never, items as never, 'med').value.value).toBe(0.1)
  })

  it('carries an item pointing at something that is not a container', () => {
    const rope = { _id: 'rope', type: 'equipment', system: { quantity: 1, bulk: { value: 1 } } }
    const items = [rope, elixir('rope')]
    expect(inventoryBulk(items as never, 0, 'med').value.value).toBe(1.1)
  })

  it('carries an item that names itself, rather than recurring on it', () => {
    const items = [{ ...pack, system: { ...pack.system, containerId: 'pack' } }]
    expect(inventoryBulk(items as never, 0, 'med').value.value).toBe(0)
  })
})

// PF2e's prepareBulkData: what a thing weighs depends on whether you are wearing
// or wielding it. Reading `bulk.value` alone understated every stowed suit of
// armour on the live table by a whole Bulk, and a doffed backpack by a Light.
describe('the Bulk of a thing you are not using', () => {
  const armour = (carryType: string, value = 1) => ({
    _id: 'armour',
    type: 'armor',
    // Armour stores NO usage: PF2e assigns `wornarmor` in preparation, so a
    // world-dump armour arrives with the field missing.
    system: { quantity: 1, bulk: { value }, equipped: { carryType, inSlot: true } }
  })

  it('weighs worn armour as stored', () => {
    expect(
      computeTotalBulk([armour('worn')] as never, [armour('worn')] as never, 'med').value
    ).toBe(1)
  })

  it('weighs stowed armour a whole Bulk heavier', () => {
    // The live case: Studded Leather stowed in a backpack, 1 Bulk worn and 2
    // carried, and a character a full Bulk light for it.
    expect(
      computeTotalBulk([armour('stowed')] as never, [armour('stowed')] as never, 'med').value
    ).toBe(2)
  })

  it('steps a Light suit up to 1 rather than adding a whole Bulk', () => {
    expect(
      computeTotalBulk([armour('stowed', 0.1)] as never, [armour('stowed', 0.1)] as never, 'med')
        .value
    ).toBe(1)
  })

  it('steps a negligible suit up to Light', () => {
    expect(
      computeTotalBulk([armour('stowed', 0)] as never, [armour('stowed', 0)] as never, 'med').value
    ).toBe(0.1)
  })

  const pack = (carryType: string) => ({
    _id: 'pack',
    type: 'backpack',
    system: {
      quantity: 1,
      usage: { value: 'wornbackpack' },
      // A container that does not stow is replaced by its contents, so the
      // flag has to be here for the backpack itself to weigh anything.
      stowing: true,
      bulk: { value: 0, heldOrStowed: 0.1, capacity: 4, ignored: 2 },
      equipped: { carryType, inSlot: true }
    }
  })

  it('weighs a worn backpack as nothing and a held one as Light', () => {
    expect(computeTotalBulk([pack('worn')] as never, [pack('worn')] as never, 'med').value).toBe(0)
    expect(computeTotalBulk([pack('held')] as never, [pack('held')] as never, 'med').value).toBe(
      0.1
    )
  })

  it('needs the worn slot, not merely the carry type', () => {
    // `wornbackpack` names a slot, so PF2e wants `inSlot` too.
    const outOfSlot = {
      ...pack('worn'),
      system: { ...pack('worn').system, equipped: { carryType: 'worn', inSlot: false } }
    }
    expect(computeTotalBulk([outOfSlot] as never, [outOfSlot] as never, 'med').value).toBe(0.1)
  })

  it('counts a held weapon as equipped only with hands enough for it', () => {
    const halberd = (handsHeld: number) => ({
      _id: 'halberd',
      type: 'weapon',
      system: {
        quantity: 1,
        usage: { value: 'held-in-two-hands' },
        bulk: { value: 2, heldOrStowed: 2 },
        equipped: { carryType: 'held', handsHeld }
      }
    })
    expect(computeTotalBulk([halberd(2)] as never, [halberd(2)] as never, 'med').value).toBe(2)
    expect(computeTotalBulk([halberd(1)] as never, [halberd(1)] as never, 'med').value).toBe(2)
  })

  it('weighs a dropped item by its stowed Bulk', () => {
    const dropped = {
      _id: 'd',
      type: 'equipment',
      system: {
        quantity: 1,
        usage: { value: 'held-in-one-hand' },
        bulk: { value: 0, heldOrStowed: 1 },
        equipped: { carryType: 'dropped', handsHeld: 0 }
      }
    }
    expect(computeTotalBulk([dropped] as never, [dropped] as never, 'med').value).toBe(1)
  })
})
