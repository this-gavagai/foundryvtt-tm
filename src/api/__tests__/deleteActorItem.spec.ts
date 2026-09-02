import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { TablemateActor } from '@/types/character-types'

// deleteActorItem writes straight at the server over `modifyDocument`, so none
// of PF2e's client-side `ItemPF2e.deleteDocuments` runs — the grant cascade has
// to be replayed here. These specs pin the socket traffic that replay produces.

const emit = vi.hoisted(() => vi.fn())

vi.mock('@/api/internal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/internal')>()),
  getSocket: async () => ({ emit })
}))
vi.mock('@/api/characterSync', () => ({ fireRefresh: vi.fn() }))

const { deleteActorItem } = await import('@/api/documents')

type Payload = { action: string; type: string; operation: Record<string, unknown> }

// Answer every modifyDocument with the shape Foundry sends back for that
// action, so processChanges has something valid to apply.
function respondOk() {
  emit.mockImplementation((_event: string, payload: Payload, ack: (r: unknown) => void) => {
    const result =
      payload.action === 'delete'
        ? (payload.operation.ids as string[])
        : (payload.operation.updates as unknown[])
    ack({ action: payload.action, result })
  })
}

const calls = () => emit.mock.calls.map((c) => c[1] as Payload)
const callsFor = (action: string) => calls().filter((p) => p.action === action)

// The real PF2e 8.4.1 death-condition graph (see utils/__tests__/itemGrants).
function dyingCharacter() {
  return ref({
    _id: 'actor-1',
    items: [
      {
        _id: 'd',
        name: 'Dying',
        type: 'condition',
        flags: { pf2e: { itemGrants: { unconscious: { id: 'u', onDelete: 'restrict' } } } }
      },
      {
        _id: 'u',
        name: 'Unconscious',
        type: 'condition',
        flags: {
          pf2e: {
            grantedBy: { id: 'd', onDelete: 'cascade' },
            itemGrants: {
              blinded: { id: 'b', onDelete: 'restrict' },
              prone: { id: 'p', onDelete: 'restrict' }
            }
          }
        }
      },
      {
        _id: 'b',
        name: 'Blinded',
        type: 'condition',
        flags: { pf2e: { grantedBy: { id: 'u', onDelete: 'cascade' } } }
      },
      {
        _id: 'p',
        name: 'Prone',
        type: 'condition',
        flags: { pf2e: { grantedBy: { id: 'u', onDelete: 'detach' } } }
      }
    ]
  }) as unknown as import('vue').Ref<TablemateActor>
}

beforeEach(() => {
  emit.mockReset()
  respondOk()
})

describe('deleteActorItem', () => {
  it('deletes the whole cascade in one request when the root condition goes', async () => {
    const actor = dyingCharacter()
    await deleteActorItem(actor, 'd')
    const deletes = callsFor('delete')
    expect(deletes).toHaveLength(1)
    expect((deletes[0].operation.ids as string[]).sort()).toEqual(['b', 'd', 'u'])
  })

  it('detaches the surviving grantee before the delete lands', async () => {
    const actor = dyingCharacter()
    await deleteActorItem(actor, 'd')
    expect(calls().map((p) => p.action)).toEqual(['update', 'delete'])
    expect(callsFor('update')[0].operation.updates).toEqual([
      { _id: 'p', flags: { pf2e: { '-=grantedBy': null } } }
    ])
  })

  it('drops the dangling grantedBy from the local mirror too', async () => {
    const actor = dyingCharacter()
    await deleteActorItem(actor, 'd')
    const prone = [...actor.value.items].find((i) => i._id === 'p') as unknown as {
      flags: { pf2e: Record<string, unknown> }
    }
    expect(prone.flags.pf2e).not.toHaveProperty('grantedBy')
  })

  it('removes the cascaded items from the local mirror', async () => {
    const actor = dyingCharacter()
    await deleteActorItem(actor, 'd')
    expect([...actor.value.items].map((i) => i._id)).toEqual(['p'])
  })

  it('refuses a removal a granting item restricts, without touching the socket', async () => {
    const actor = dyingCharacter()
    await expect(deleteActorItem(actor, 'u')).rejects.toThrow(
      "Unconscious can't be removed while Dying is applied"
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('falls back to the requested id when the item list has nothing to say', async () => {
    const actor = ref({ _id: 'actor-1', items: [] }) as unknown as import('vue').Ref<TablemateActor>
    await deleteActorItem(actor, 'ghost')
    expect(callsFor('delete')[0].operation.ids).toEqual(['ghost'])
  })
})
