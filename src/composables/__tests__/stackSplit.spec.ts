// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'

// Splitting a stack is a create followed by a decrement, in that order: the
// difference between the two writes is quantity that exists nowhere else, so a
// create that fails has to leave the original stack whole.
const createActorItem = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
const updateActorItem = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))

vi.mock('@/api/documents', () => ({
  createActorItem: (...args: unknown[]) => createActorItem(...args),
  updateActorItem: (...args: unknown[]) => updateActorItem(...args),
  deleteActorItem: vi.fn(() => Promise.resolve(null))
}))
vi.mock('@/api/actionRpc', () => ({
  attachItem: vi.fn(() => Promise.resolve(null)),
  consumeItem: vi.fn(() => Promise.resolve(null)),
  detachItem: vi.fn(() => Promise.resolve(null))
}))

const { useCharacterItems } = await import('@/composables/character/characterItems')

// An arrow stack as the app holds one: wire JSON on the actor, not a live
// PF2e document (see the app-actors-are-wire-JSON caveat).
function arrows(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'arrows',
    type: 'consumable',
    name: 'Arrows',
    img: 'icons/arrows.webp',
    system: {
      slug: 'arrows',
      quantity: 10,
      description: { value: '' },
      traits: { rarity: 'common', value: [] },
      level: { value: 0 },
      equipped: { carryType: 'stowed', handsHeld: 0, inSlot: false },
      containerId: 'backpack-1',
      price: { value: { cp: 1 }, per: 10 },
      bulk: { value: 0 },
      identification: { status: 'identified' }
    },
    ...overrides
  }
}

// Cast at the fixture boundary, once — the same one characterStrikes.spec makes:
// TablemateCharacter claims CharacterPF2e, but what the app holds (here and in
// production) is the plain JSON the Foundry side serialized with toObject().
function inventoryOf(item: Record<string, unknown>) {
  const actor = ref({ _id: 'seelah', items: [item], inventory: {} }) as unknown as Ref<
    TablemateCharacter | undefined
  >
  return useCharacterItems(actor).inventory
}

const createdItem = () => (createActorItem.mock.calls[0][1] as Record<string, unknown>[])[0]

beforeEach(() => {
  createActorItem.mockClear().mockResolvedValue({})
  updateActorItem.mockClear().mockResolvedValue({})
})

describe('InventoryItem.splitStack', () => {
  it('creates the split-off stack, then decrements the original', async () => {
    const inventory = inventoryOf(arrows())
    await inventory.value![0].splitStack!(4)

    expect(createActorItem).toHaveBeenCalledTimes(1)
    const created = createdItem()
    expect(created._id).toBeUndefined()
    expect((created.system as { quantity: number }).quantity).toBe(4)
    // Everything else about the item comes along, so the new stack is the same
    // arrows in the same backpack rather than a bare copy of its name.
    expect((created.system as { containerId: string }).containerId).toBe('backpack-1')
    expect(created.name).toBe('Arrows')

    expect(updateActorItem).toHaveBeenCalledTimes(1)
    expect(updateActorItem.mock.calls[0][1]).toBe('arrows')
    expect(updateActorItem.mock.calls[0][2]).toEqual({ system: { quantity: 6 } })
  })

  it('leaves the stack whole when the create fails', async () => {
    createActorItem.mockRejectedValue(new Error('denied'))
    const inventory = inventoryOf(arrows())

    await expect(inventory.value![0].splitStack!(4)).rejects.toThrow('denied')
    expect(updateActorItem).not.toHaveBeenCalled()
  })

  it.each([0, 10, 11, -3, 0.5])('writes nothing for a count of %s', async (count) => {
    const inventory = inventoryOf(arrows())
    expect(await inventory.value![0].splitStack!(count)).toBeNull()
    expect(createActorItem).not.toHaveBeenCalled()
    expect(updateActorItem).not.toHaveBeenCalled()
  })

  it('leaves attached items on the stack they were attached to', async () => {
    const stack = arrows()
    // A real subitem is a full physical item of its own — which is the whole
    // problem with copying one: the split would conjure a second document.
    ;(stack.system as Record<string, unknown>).subitems = [
      { ...arrows(), _id: 'boss', name: 'Shield Boss' }
    ]
    const inventory = inventoryOf(stack)
    await inventory.value![0].splitStack!(1)

    expect((createdItem().system as Record<string, unknown>).subitems).toBeUndefined()
  })

  it('drops the grant links, which belong to the granted item and not to a copy', async () => {
    const inventory = inventoryOf(
      arrows({
        flags: { pf2e: { grantedBy: { id: 'feat-1' }, itemGrants: { other: { id: 'x' } } } }
      })
    )
    await inventory.value![0].splitStack!(2)

    const flags = createdItem().flags as { pf2e: Record<string, unknown> }
    expect(flags.pf2e.grantedBy).toBeUndefined()
    expect(flags.pf2e.itemGrants).toBeUndefined()
  })
})
