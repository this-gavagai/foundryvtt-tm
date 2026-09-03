import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { TablemateActor } from '@/types/character-types'

// replaceItemRules is the item lane's one BROAD write: it replaces an item's
// whole `system.rules` array rather than setting a field inside it.
//
// It exists to be spelled differently from updateActorItem — the widest write in
// the app read exactly like the narrowest — and to carry the guard that makes
// the difference matter. A rules array that is missing or empty means the
// caller's mirror had moved on, and writing it would strip every rule element
// off the item: its modifiers, its notes, its toggles. Foundry drops an
// `undefined` during serialization, so that case used to no-op in silence.

const emit = vi.hoisted(() => vi.fn())
const fireRefresh = vi.hoisted(() => vi.fn())

vi.mock('@/api/internal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/internal')>()),
  getSocket: async () => ({ emit })
}))
vi.mock('@/api/characterSync', () => ({ fireRefresh }))

const { replaceItemRules } = await import('@/api/documents')

type Payload = { action: string; type: string; operation: Record<string, unknown> }

function respondOk() {
  emit.mockImplementation((_event: string, payload: Payload, ack: (r: unknown) => void) => {
    ack({ action: payload.action, result: payload.operation.updates })
  })
}

const updatesSent = () =>
  (emit.mock.calls.at(-1)?.[1] as Payload | undefined)?.operation.updates as
    | { _id: string; system: { rules: object[] } }[]
    | undefined

const rule = (option: string, value = false) => ({ key: 'RollOption', option, value })

function actorWithRules() {
  return ref({
    _id: 'actor-1',
    items: [
      { _id: 'feat-a', system: { rules: [rule('finisher')] } },
      { _id: 'feat-b', system: { rules: [rule('finisher'), rule('panache')] } }
    ]
  }) as unknown as TablemateActor
}

const actorRef = () => ref(actorWithRules()) as never

beforeEach(() => {
  vi.clearAllMocks()
  respondOk()
})

describe('replaceItemRules', () => {
  it('writes one item’s whole rules array', async () => {
    const rules = [rule('finisher', true)]
    await replaceItemRules(actorRef(), [{ itemId: 'feat-a', rules }])

    expect(updatesSent()).toEqual([{ _id: 'feat-a', system: { rules } }])
  })

  it('writes several items in one modifyDocument, each with its own array', async () => {
    const a = [rule('finisher', true)]
    const b = [rule('finisher', true), rule('panache')]
    await replaceItemRules(actorRef(), [
      { itemId: 'feat-a', rules: a },
      { itemId: 'feat-b', rules: b }
    ])

    // One socket round trip, not one per item: the roll-option toggle fans out
    // across every contributing item and they must move together.
    expect(emit).toHaveBeenCalledTimes(1)
    expect(updatesSent()).toEqual([
      { _id: 'feat-a', system: { rules: a } },
      { _id: 'feat-b', system: { rules: b } }
    ])
  })

  it('refreshes the actor once the write lands', async () => {
    await replaceItemRules(actorRef(), [{ itemId: 'feat-a', rules: [rule('finisher', true)] }])
    expect(fireRefresh).toHaveBeenCalledWith('actor-1')
  })
})

// Each of these would have reached the server as a write that strips an item's
// rules, or as a silent no-op. Both now fail the way an unlisted actor path
// does: nothing is sent, the actor is refreshed, and the caller sees the throw.
describe('the guard', () => {
  const refused = async (updates: { itemId: string; rules: object[] }[]) => {
    await expect(replaceItemRules(actorRef(), updates)).rejects.toThrow(/Refusing to replace rules/)
    expect(emit).not.toHaveBeenCalled()
    expect(fireRefresh).toHaveBeenCalled()
  }

  it('refuses an empty rules array — the write that would strip the item', async () => {
    await refused([{ itemId: 'feat-a', rules: [] }])
  })

  it('refuses a missing rules array, which used to serialize away to nothing', async () => {
    await refused([{ itemId: 'feat-a', rules: undefined as unknown as object[] }])
  })

  it('refuses an update with no item id', async () => {
    await refused([{ itemId: '', rules: [rule('finisher')] }])
  })

  it('refuses the whole write when only ONE of several items is unusable', async () => {
    // All-or-nothing on purpose: the toggle's contributors move together, and a
    // partial write would leave one row's items disagreeing with the control.
    await refused([
      { itemId: 'feat-a', rules: [rule('finisher', true)] },
      { itemId: 'feat-b', rules: [] }
    ])
  })

  it('refuses a write with nothing in it', async () => {
    await refused([])
  })

  it('names the items it refused, so the cause is in the log', async () => {
    await expect(replaceItemRules(actorRef(), [{ itemId: 'feat-b', rules: [] }])).rejects.toThrow(
      /feat-b/
    )
  })
})
