import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { RestForTheNightArgs } from '@/types/api-types'

// The handler is deliberately thin — PF2e owns every rule a rest applies — so
// what is worth pinning is not what it does but what it refuses and what it
// passes on:
//
//   * `skipDialog` is always true. PF2e's confirmation is a dialog on whichever
//     client runs the rest, which is a GM's; left on, a player's tap hangs
//     behind a prompt on someone else's screen asking a question the player
//     already answered on the tablet.
//   * a non-character is refused HERE. PF2e filters them out of its own list
//     and reports the empty result with ui.notifications.error — on the GM's
//     screen, while the app's request acks as though the night passed.
//   * a missing `restForTheNight` is refused too, so a PF2e version that moved
//     it fails legibly instead of throwing "not a function" into the ack.

const restForTheNight = vi.fn(async () => [])

let actor: { type: string; name: string } | null
let actions: Record<string, unknown>

vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return {
    ...actual,
    getGame: vi.fn(() => ({
      actors: {
        get: (id: string) => {
          // Mirrors Foundry's `{ strict: true }`, which throws rather than
          // answering undefined for an id the world hasn't got.
          if (id !== 'seelah' || !actor) throw new Error(`no actor ${id}`)
          return actor
        }
      },
      pf2e: { actions }
    })),
    makeAck: vi.fn((args: { uuid: string }) => ({ action: TM.ACK, uuid: args.uuid, userId: 'gm' }))
  }
})

const { foundryRestForTheNight } = await import('@/foundry/handlers/restForTheNight')

const args = (over: Partial<RestForTheNightArgs> = {}): RestForTheNightArgs => ({
  action: TM.REST_FOR_THE_NIGHT,
  uuid: 'req-1',
  userId: 'player',
  characterId: 'seelah',
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  actor = { type: 'character', name: 'Seelah' }
  actions = { get: () => undefined, restForTheNight }
})

describe('foundryRestForTheNight', () => {
  it('rests the named character through PF2e, skipping its dialog', async () => {
    await foundryRestForTheNight(args())

    expect(restForTheNight).toHaveBeenCalledTimes(1)
    expect(restForTheNight).toHaveBeenCalledWith({ actors: actor, skipDialog: true })
  })

  it('acks the request it was given', async () => {
    const ack = await foundryRestForTheNight(args({ uuid: 'req-9' }))
    expect(ack).toMatchObject({ action: TM.ACK, uuid: 'req-9' })
  })

  it('refuses anything that is not a character', async () => {
    // A familiar has a sheet in this app and an owner who could tap the button
    // if it ever reached one; PF2e would drop it silently.
    actor = { type: 'familiar', name: 'Sneef' }
    await expect(foundryRestForTheNight(args())).rejects.toThrow(/familiar/)
    expect(restForTheNight).not.toHaveBeenCalled()
  })

  it('refuses when this PF2e version has no restForTheNight', async () => {
    actions = { get: () => undefined }
    await expect(foundryRestForTheNight(args())).rejects.toThrow(/restForTheNight/)
  })

  it('lets a failed rest reject rather than acking a night that did not pass', async () => {
    restForTheNight.mockRejectedValueOnce(new Error('recharge blew up'))
    await expect(foundryRestForTheNight(args())).rejects.toThrow('recharge blew up')
  })
})
