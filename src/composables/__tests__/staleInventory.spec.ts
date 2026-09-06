// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { dropStaleInventory } from '@/composables/useActorSync'

// A direct write lands on the server immediately; everything PF2e DERIVES from
// it only comes back when a payload does. For the inventory that gap is
// unnecessary — the sheet can compute Bulk, container capacity and item names
// itself, exactly — so the payload's copy is dropped the moment a write makes it
// obsolete, and the existing "prepared, else derived" reads take over.
//
// `as never` throughout: TablemateActor is deep enough that instantiating it
// here times the checker out, and none of these assertions needs more than the
// two fields being touched.
const actor = (over: Record<string, unknown> = {}) =>
  ref({
    _id: 'a1',
    inventory: {
      bulk: { max: 10, value: { value: 3 } },
      containers: { c1: { value: 1 } },
      labels: { i1: '+1 Striking Longsword' }
    },
    system: { attributes: { ac: { value: 20 } } },
    ...over
  }) as never

const inventoryOf = (a: unknown) =>
  (a as { value: { inventory: Record<string, unknown> } }).value.inventory

describe('dropping the inventory a write has made stale', () => {
  it('clears the whole derived block', () => {
    const a = actor()
    dropStaleInventory(a)
    const inv = inventoryOf(a)
    expect(inv.bulk).toBeUndefined()
    expect(inv.containers).toBeUndefined()
    expect(inv.labels).toBeUndefined()
  })

  // The statistics derive through the rule engine and can be short a rule
  // element it cannot see, so a stale-but-complete AC is not obviously worse
  // than a fresh-but-provisional one. Left alone deliberately.
  it('leaves the statistics alone', () => {
    const a = actor()
    dropStaleInventory(a)
    const system = (a as { value: { system: { attributes: { ac: unknown } } } }).value.system
    expect(system.attributes.ac).toBeDefined()
  })

  it('leaves the item list alone — only the derived block goes', () => {
    const a = actor({ items: [{ _id: 'i1', name: 'Longsword' }] })
    dropStaleInventory(a)
    expect((a as { value: { items: unknown[] } }).value.items).toHaveLength(1)
  })

  it('is harmless with no inventory, or no actor at all', () => {
    expect(() => dropStaleInventory(ref({ _id: 'a1' }) as never)).not.toThrow()
    expect(() => dropStaleInventory(ref(undefined) as never)).not.toThrow()
  })
})
