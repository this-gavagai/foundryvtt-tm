// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'

// Merging is a credit followed by a delete, in that order: the quantity has to
// exist on the survivor before it stops existing on the source, or a failure
// between the two writes destroys goods.
const order: string[] = []
const updateActorItem = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => {
  order.push('update')
  return Promise.resolve({})
})
const deleteActorItem = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => {
  order.push('delete')
  return Promise.resolve({})
})

vi.mock('@/api/documents', () => ({
  createActorItem: vi.fn(() => Promise.resolve({})),
  updateActorItem: (...args: unknown[]) => updateActorItem(...args),
  deleteActorItem: (...args: unknown[]) => deleteActorItem(...args)
}))
vi.mock('@/api/internal', () => ({ asDocumentArray: (col: unknown) => col }))
vi.mock('@/api/actionRpc', () => ({
  attachItem: vi.fn(() => Promise.resolve(null)),
  consumeItem: vi.fn(() => Promise.resolve(null)),
  detachItem: vi.fn(() => Promise.resolve(null))
}))

const { useCharacterItems } = await import('@/composables/character/characterItems')

function arrows(id: string, quantity: number, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    type: 'consumable',
    name: 'Arrows',
    img: 'icons/arrows.webp',
    system: {
      slug: 'arrows',
      quantity,
      uses: { value: 1, max: 1 },
      description: { value: '' },
      traits: { rarity: 'common', value: [] },
      level: { value: 0 },
      equipped: { carryType: 'stowed', handsHeld: 0, inSlot: false },
      containerId: null,
      price: { value: { cp: 1 }, per: 10 },
      bulk: { value: 0 },
      identification: { status: 'identified' },
      ...((overrides.system as Record<string, unknown>) ?? {})
    },
    ...overrides
  }
}

// Cast at the fixture boundary, once — TablemateCharacter claims CharacterPF2e,
// but what the app holds is the JSON the Foundry side serialized.
function inventoryOf(items: Record<string, unknown>[]) {
  const actor = ref({ _id: 'seelah', items, inventory: {} }) as unknown as Ref<
    TablemateCharacter | undefined
  >
  return useCharacterItems(actor).inventory
}

beforeEach(() => {
  order.length = 0
  updateActorItem.mockClear().mockImplementation(() => {
    order.push('update')
    return Promise.resolve({})
  })
  deleteActorItem.mockClear().mockImplementation(() => {
    order.push('delete')
    return Promise.resolve({})
  })
})

describe('InventoryItem.stackableIds', () => {
  it('names the stacks this one could absorb', () => {
    const inventory = inventoryOf([
      arrows('a', 10),
      arrows('b', 4),
      arrows('c', 2, { name: 'Bolts' })
    ])
    expect(inventory.value![0].stackableIds!()).toEqual(['b'])
  })

  it('is empty when nothing matches', () => {
    const inventory = inventoryOf([arrows('a', 10), arrows('c', 2, { name: 'Bolts' })])
    expect(inventory.value![0].stackableIds!()).toEqual([])
  })
})

describe('InventoryItem.mergeStack', () => {
  it('credits the survivor before deleting the source', async () => {
    const inventory = inventoryOf([arrows('a', 10), arrows('b', 4)])
    await inventory.value![0].mergeStack!(['b'])

    expect(order).toEqual(['update', 'delete'])
    expect(updateActorItem.mock.calls[0][1]).toBe('a')
    expect(updateActorItem.mock.calls[0][2]).toEqual({ system: { quantity: 14 } })
    expect(deleteActorItem.mock.calls[0][1]).toEqual(['b'])
  })

  it('folds several stacks in at once', async () => {
    const inventory = inventoryOf([arrows('a', 10), arrows('b', 4), arrows('c', 6)])
    await inventory.value![0].mergeStack!(['b', 'c'])

    expect(updateActorItem.mock.calls[0][2]).toEqual({ system: { quantity: 20 } })
    expect(deleteActorItem.mock.calls[0][1]).toEqual(['b', 'c'])
  })

  // The menu that offered the merge was built against an older inventory, so
  // the ids are re-checked here rather than trusted.
  it('ignores an id that is not stackable with this item', async () => {
    const inventory = inventoryOf([
      arrows('a', 10),
      arrows('b', 4),
      arrows('c', 2, { name: 'Bolts' })
    ])
    await inventory.value![0].mergeStack!(['b', 'c'])

    expect(updateActorItem.mock.calls[0][2]).toEqual({ system: { quantity: 14 } })
    expect(deleteActorItem.mock.calls[0][1]).toEqual(['b'])
  })

  it('writes nothing when none of the ids are stackable', async () => {
    const inventory = inventoryOf([arrows('a', 10), arrows('c', 2, { name: 'Bolts' })])
    expect(await inventory.value![0].mergeStack!(['c'])).toBeNull()
    expect(updateActorItem).not.toHaveBeenCalled()
    expect(deleteActorItem).not.toHaveBeenCalled()
  })

  it('keeps the source when the credit fails', async () => {
    updateActorItem.mockRejectedValue(new Error('denied'))
    const inventory = inventoryOf([arrows('a', 10), arrows('b', 4)])

    await expect(inventory.value![0].mergeStack!(['b'])).rejects.toThrow('denied')
    expect(deleteActorItem).not.toHaveBeenCalled()
  })
})
