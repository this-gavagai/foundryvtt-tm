import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { NextTurnArgs } from '@/types/api-types'

// The app's End Turn button reaches a GM client because a player cannot write
// the Combat document. That makes this handler the whole security boundary for
// the feature: the RPC table only proves the requester owns the actor they
// NAMED, which every player does for some actor. Two rules live here —
//
//   * the actor named must be the one holding the turn (a player may end their
//     own turn, not someone else's), and
//   * the round/turn the app was showing must still be live, because requests
//     are dispatched one at a time and a tap can queue behind a slow roll.
//
// Both are the difference between "hands the turn on" and "skips the next
// player", so they are pinned rather than trusted.

const nextTurn = vi.fn(async () => ({}))

interface FakeCombat {
  started: boolean
  round: number
  turn: number
  combatant: { actorId: string } | null
  nextTurn: typeof nextTurn
}

let combat: FakeCombat | null
let requesterIsGM = false

vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return {
    ...actual,
    getGame: vi.fn(() => ({
      combats: { get: (id: string) => (id === 'c1' ? combat : null) },
      users: { get: () => ({ isGM: requesterIsGM }) }
    })),
    makeAck: vi.fn((args: { uuid: string }) => ({ action: TM.ACK, uuid: args.uuid, userId: 'gm' }))
  }
})

const { foundryNextTurn } = await import('@/foundry/handlers/nextTurn')

const args = (over: Partial<NextTurnArgs> = {}): NextTurnArgs => ({
  action: TM.NEXT_TURN,
  uuid: 'req-1',
  userId: 'player',
  actorId: 'seelah',
  combatId: 'c1',
  round: 3,
  turn: 1,
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  requesterIsGM = false
  combat = {
    started: true,
    round: 3,
    turn: 1,
    combatant: { actorId: 'seelah' },
    nextTurn
  }
})

describe('foundryNextTurn', () => {
  it('advances the encounter for the player whose turn it is', async () => {
    const ack = await foundryNextTurn(args())
    expect(nextTurn).toHaveBeenCalledOnce()
    expect(ack).toMatchObject({ action: TM.ACK, uuid: 'req-1' })
  })

  it('refuses to end a turn that belongs to someone else', async () => {
    combat!.combatant = { actorId: 'kyra' }
    await expect(foundryNextTurn(args())).rejects.toThrow(/does not hold the current turn/)
    expect(nextTurn).not.toHaveBeenCalled()
  })

  // A GM advances the tracker for anyone in Foundry; the app offers them the
  // same, so ownership is not their gate.
  it('lets a GM end an NPC turn', async () => {
    requesterIsGM = true
    combat!.combatant = { actorId: 'goblin' }
    await foundryNextTurn(args())
    expect(nextTurn).toHaveBeenCalledOnce()
  })

  // The staleness guard is what stops a queued tap skipping the NEXT player.
  it('refuses a request whose turn has already advanced', async () => {
    combat!.turn = 2
    await expect(foundryNextTurn(args())).rejects.toThrow(/turn already advanced/)
    expect(nextTurn).not.toHaveBeenCalled()
  })

  it('refuses a request from a previous round', async () => {
    combat!.round = 4
    combat!.turn = 1
    await expect(foundryNextTurn(args())).rejects.toThrow(/turn already advanced/)
    expect(nextTurn).not.toHaveBeenCalled()
  })

  // It applies to a GM too: it guards against a stale request, not against the
  // requester.
  it('refuses a stale request from a GM as well', async () => {
    requesterIsGM = true
    combat!.turn = 2
    await expect(foundryNextTurn(args())).rejects.toThrow(/turn already advanced/)
    expect(nextTurn).not.toHaveBeenCalled()
  })

  it('refuses when the encounter has not started', async () => {
    combat!.started = false
    await expect(foundryNextTurn(args())).rejects.toThrow(/has not started/)
    expect(nextTurn).not.toHaveBeenCalled()
  })

  it('refuses when the named encounter is gone', async () => {
    combat = null
    await expect(foundryNextTurn(args())).rejects.toThrow(/no encounter c1/)
    expect(nextTurn).not.toHaveBeenCalled()
  })
})
