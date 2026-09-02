import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TM } from '@/api/protocol'
import type { SetHitPointsArgs } from '@/types/api-types'

// A manual HP edit is a plain field write — the same thing PF2e's own character
// sheet does with its `system.attributes.hp.value` input. What makes it an RPC
// rather than a direct socket write is only WHERE it runs: Foundry fires
// `preUpdateActor` (where module HP automation lives) on the client that calls
// actor.update(), and the app's direct write calls it on no client at all.
//
// So these specs pin two things: that the write is faithful to what the player
// typed (not re-resolved as damage), and that it lands as ONE update, since a
// module deciding whether this crossed 0 reads the whole edit at once.

const update = vi.fn<(changes: Record<string, unknown>) => Promise<object>>(async () => ({}))
const applyDamage = vi.fn()

function makeActor(opts: { value?: number; temp?: number } = {}) {
  return {
    name: 'Seelah',
    _id: 'seelah-id',
    hitPoints: { value: opts.value ?? 20, max: 30, temp: opts.temp ?? 0 },
    update,
    applyDamage
  }
}

let actor = makeActor()

vi.mock('@/foundry/utils/foundry', async (importActual) => {
  const actual = await importActual<typeof import('@/foundry/utils/foundry')>()
  return {
    ...actual,
    getGame: vi.fn(() => ({})),
    getCharacter: vi.fn(() => actor),
    makeAck: vi.fn((args: { uuid: string }) => ({ action: TM.ACK, uuid: args.uuid, userId: 'gm' }))
  }
})

const { foundrySetHitPoints } = await import('@/foundry/handlers/setHitPoints')

const args = (over: Partial<SetHitPointsArgs> = {}): SetHitPointsArgs => ({
  action: TM.SET_HIT_POINTS,
  uuid: 'req-1',
  userId: 'user-1',
  characterId: 'seelah-id',
  ...over
})

beforeEach(() => {
  update.mockClear()
  applyDamage.mockClear()
  actor = makeActor()
})

describe('foundrySetHitPoints', () => {
  it('writes the requested value through the actor, so the pre-update hooks run', async () => {
    await foundrySetHitPoints(args({ value: 12 }))
    expect(update).toHaveBeenCalledWith({ 'system.attributes.hp.value': 12 })
  })

  it('does not re-resolve the edit as damage', async () => {
    // PF2e's sheet field is a plain override; only the token HP bar goes through
    // applyDamage. Routing a manual correction there would apply IWR, consume
    // temporary hit points, and post a damage card.
    await foundrySetHitPoints(args({ value: 12 }))
    expect(applyDamage).not.toHaveBeenCalled()
  })

  it('lands the number the player typed even with temporary hit points up', async () => {
    actor = makeActor({ value: 20, temp: 5 })
    await foundrySetHitPoints(args({ value: 12 }))
    expect(update).toHaveBeenCalledWith({ 'system.attributes.hp.value': 12 })
  })

  it('sends hit points and temporary hit points as one update', async () => {
    await foundrySetHitPoints(args({ value: 12, temp: 10 }))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      'system.attributes.hp.value': 12,
      'system.attributes.hp.temp': 10
    })
  })

  it('omits a field the request left out, rather than zeroing it', async () => {
    actor = makeActor({ temp: 5 })
    await foundrySetHitPoints(args({ value: 12 }))
    expect(update.mock.calls[0][0]).not.toHaveProperty('system.attributes.hp.temp')
  })

  it('sets temporary hit points on their own', async () => {
    await foundrySetHitPoints(args({ temp: 4 }))
    expect(update).toHaveBeenCalledWith({ 'system.attributes.hp.temp': 4 })
  })

  it('writes nothing when the request carries neither field', async () => {
    await foundrySetHitPoints(args())
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses an actor with no hit points instead of writing a field it lacks', async () => {
    actor = { ...makeActor(), hitPoints: undefined } as unknown as ReturnType<typeof makeActor>
    await expect(foundrySetHitPoints(args({ value: 12 }))).rejects.toThrow('has no hit points')
    expect(update).not.toHaveBeenCalled()
  })
})
