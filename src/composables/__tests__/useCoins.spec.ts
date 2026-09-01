import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'

const modifyDocument = vi.fn().mockResolvedValue({ result: [] })
const getCompendiumSource = vi.fn()

vi.mock('@/api/documents', () => ({
  modifyDocument: (...args: unknown[]) => modifyDocument(...args),
  processChanges: vi.fn()
}))
vi.mock('@/api/internal', () => ({ asDocumentArray: () => [] }))
vi.mock('@/api/characterSync', () => ({ fireRefresh: vi.fn() }))
vi.mock('@/api/compendium', () => ({
  getCompendiumSource: (...args: unknown[]) => getCompendiumSource(...args)
}))

const { useCoins } = await import('@/composables/useCoins')

// A coin stack as the app holds one: wire JSON plus the write closures
// characterItems binds onto it.
const METAL: Record<string, string> = {
  pp: 'platinum',
  gp: 'gold',
  sp: 'silver',
  cp: 'copper'
}

function stack(denomination: string, quantity: number) {
  return {
    _id: `${denomination}-stack`,
    type: 'treasure',
    system: {
      slug: `${METAL[denomination]}-pieces`,
      stackGroup: 'coins',
      quantity,
      price: { value: { [denomination]: 1 } }
    },
    changeQty: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null)
  }
}

function purse(items: ReturnType<typeof stack>[]) {
  const inventory = ref(items)
  return { inventory, ...useCoins({ actorId: ref('actor-1'), actor: ref({ items: [] }), inventory }) }
}

beforeEach(() => {
  modifyDocument.mockClear()
  getCompendiumSource.mockReset().mockResolvedValue({
    name: 'Gold Pieces',
    type: 'treasure',
    system: { slug: 'gold-pieces', stackGroup: 'coins', quantity: 1 }
  })
})

describe('useCoins', () => {
  it('reads the purse off the inventory', () => {
    const { counts, totalCopper } = purse([stack('gp', 143), stack('sp', 27)])
    expect(counts.value).toEqual({ pp: 0, gp: 143, sp: 27, cp: 0 })
    expect(totalCopper.value).toBe(14570)
  })

  it('bumps an existing stack once for the whole batch', async () => {
    const gold = stack('gp', 100)
    const { applyDeltas } = purse([gold])
    await applyDeltas({ gp: 43 })
    expect(gold.changeQty).toHaveBeenCalledTimes(1)
    expect(gold.changeQty).toHaveBeenCalledWith(143)
  })

  it('deletes a stack the change empties, as PF2e does', async () => {
    const silver = stack('sp', 5)
    const { applyDeltas } = purse([silver])
    await applyDeltas({ sp: -5 })
    expect(silver.delete).toHaveBeenCalledTimes(1)
    expect(silver.changeQty).not.toHaveBeenCalled()
  })

  it('never writes a negative quantity', async () => {
    const silver = stack('sp', 5)
    const { applyDeltas } = purse([silver])
    await applyDeltas({ sp: -50 })
    expect(silver.delete).toHaveBeenCalledTimes(1)
  })

  it('creates a stack from the pf2e coin item when the purse has none', async () => {
    const { applyDeltas } = purse([])
    await applyDeltas({ gp: 20 })
    expect(getCompendiumSource).toHaveBeenCalledWith(
      'Compendium.pf2e.equipment-srd.Item.B6B7tBWJSqOBz5zz'
    )
    const [payload] = modifyDocument.mock.calls[0]
    expect(payload.action).toBe('create')
    expect(payload.operation.parentUuid).toBe('Actor.actor-1')
    expect(payload.operation.data[0].system.quantity).toBe(20)
  })

  it('falls back to a local coin stack when the compendium is unreachable', async () => {
    getCompendiumSource.mockRejectedValue(new Error('no socket'))
    const { applyDeltas } = purse([])
    await applyDeltas({ cp: 7 })
    const [payload] = modifyDocument.mock.calls[0]
    expect(payload.operation.data[0].name).toBe('Copper Pieces')
    expect(payload.operation.data[0].system.quantity).toBe(7)
  })

  it('writes nothing for an empty draft', async () => {
    const gold = stack('gp', 10)
    const { applyDeltas } = purse([gold])
    await applyDeltas({ gp: 0, sp: 0 })
    expect(gold.changeQty).not.toHaveBeenCalled()
    expect(modifyDocument).not.toHaveBeenCalled()
  })

  // The document writes don't land locally until their socket ack, and the
  // party stash discards even the ones that do when its snapshot is refetched.
  // The panel shows what it wrote until the stored data agrees.
  describe('optimism', () => {
    it('shows the written count before the inventory has caught up', async () => {
      const gold = stack('gp', 100)
      const { counts, applyDeltas } = purse([gold])
      await applyDeltas({ gp: 43 })
      expect(counts.value.gp).toBe(143)
    })

    it('counts a second edit from what is showing, not from the stale stack', async () => {
      const gold = stack('gp', 100)
      const { applyDeltas } = purse([gold])
      await applyDeltas({ gp: 43 })
      await applyDeltas({ gp: 7 })
      expect(gold.changeQty).toHaveBeenLastCalledWith(150)
    })

    it('stops standing in once the stored count agrees', async () => {
      const gold = stack('gp', 100)
      const { counts, inventory, applyDeltas } = purse([gold])
      await applyDeltas({ gp: 43 })

      inventory.value = [stack('gp', 143)]
      await nextTick()
      expect(counts.value.gp).toBe(143)

      // Someone else spends from the same purse: no overlay is left to hide it.
      inventory.value = [stack('gp', 120)]
      await nextTick()
      expect(counts.value.gp).toBe(120)
    })

    it('drops back to the stored count when the write fails', async () => {
      const gold = stack('gp', 100)
      gold.changeQty.mockRejectedValue(new Error('denied'))
      const { counts, applyDeltas } = purse([gold])

      await expect(applyDeltas({ gp: 43 })).rejects.toThrow('denied')
      expect(counts.value.gp).toBe(100)
    })

    it('shows a created stack immediately', async () => {
      const { counts, applyDeltas } = purse([])
      await applyDeltas({ pp: 3 })
      expect(counts.value.pp).toBe(3)
    })

    it('shows an emptied stack as gone immediately', async () => {
      const { counts, applyDeltas } = purse([stack('sp', 5)])
      await applyDeltas({ sp: -5 })
      expect(counts.value.sp).toBe(0)
    })
  })
})
