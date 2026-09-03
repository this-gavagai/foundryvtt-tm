import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { UseActionArgs } from '@/types/api-types'

// The Use button on a limited-use action. The handler is deliberately thin —
// PF2e's own createUseActionMessage does the spending and the card — so what
// there is to pin is the three ways a thin wrapper can lie:
//
//   * addressing the item by ID instead of UUID. rollItemMacro's ID branch
//     resolves the actor from ChatMessage.getSpeaker(), which on the handling
//     GM's client is the GM's own token/character selection. It would spend the
//     wrong creature's ability, or none, while acking success.
//   * passing an event with a modifier key set. PF2e's eventToMessageMode turns
//     a ctrl/cmd-held use into a private card, so the wrong event makes a
//     player's action card invisible to the table.
//   * acking success for a use that never happened. An item that isn't an
//     action or a feat falls through rollItemMacro to a bare toMessage(): a
//     card posts, nothing is spent, and the app's frequency pips would be a
//     use ahead of the truth until the next refresh.

const rollItemMacro = vi.fn(async () => ({ id: 'msg-1' }))

type FakeItem = { id: string; uuid: string; type: string; name: string }

let items: FakeItem[] = []
let missingActor = false

vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return {
    ...actual,
    getGame: vi.fn(() => ({
      actors: {
        get: (id: string) => {
          if (missingActor) throw new Error(`Actor ${id} does not exist`)
          return {
            name: 'Seelah',
            items: { get: (itemId: string) => items.find((i) => i.id === itemId) }
          }
        }
      },
      pf2e: { rollItemMacro }
    })),
    makeAck: vi.fn((args: { uuid: string }) => ({ action: TM.ACK, uuid: args.uuid, userId: 'gm' }))
  }
})

const { foundryUseAction } = await import('@/foundry/handlers/useAction')

const args = (itemId: string): UseActionArgs => ({
  action: TM.USE_ACTION,
  userId: 'player-1',
  characterId: 'seelah',
  itemId,
  uuid: 'req-1'
})

beforeEach(() => {
  rollItemMacro.mockClear()
  missingActor = false
  items = [
    { id: 'rage', uuid: 'Actor.seelah.Item.rage', type: 'action', name: 'Rage' },
    { id: 'sudden', uuid: 'Actor.seelah.Item.sudden', type: 'feat', name: 'Sudden Charge' },
    { id: 'potion', uuid: 'Actor.seelah.Item.potion', type: 'consumable', name: 'Healing Potion' }
  ]
})

describe('foundryUseAction', () => {
  it('uses PF2e’s own use path, addressing the item by UUID with no event', async () => {
    const ack = await foundryUseAction(args('rage'))
    expect(rollItemMacro).toHaveBeenCalledWith('Actor.seelah.Item.rage', null)
    expect(ack).toMatchObject({ action: TM.ACK, uuid: 'req-1' })
  })

  it('uses feats too — many limited-use abilities are stored as feats', async () => {
    await foundryUseAction(args('sudden'))
    expect(rollItemMacro).toHaveBeenCalledWith('Actor.seelah.Item.sudden', null)
  })

  it('refuses an item type PF2e’s use path would not spend', async () => {
    await expect(foundryUseAction(args('potion'))).rejects.toThrow(/not a usable action/)
    expect(rollItemMacro).not.toHaveBeenCalled()
  })

  it('refuses an item the named actor does not carry', async () => {
    await expect(foundryUseAction(args('someone-elses'))).rejects.toThrow(/not found on Seelah/)
    expect(rollItemMacro).not.toHaveBeenCalled()
  })

  it('propagates an unknown actor rather than acking', async () => {
    missingActor = true
    await expect(foundryUseAction(args('rage'))).rejects.toThrow()
    expect(rollItemMacro).not.toHaveBeenCalled()
  })
})
