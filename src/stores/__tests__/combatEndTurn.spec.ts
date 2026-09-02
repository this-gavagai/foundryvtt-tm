// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

// End Turn has to reach the wire with the round and turn the player was
// actually looking at — the module refuses a request that no longer matches the
// live encounter, so a wrong (or absent) payload reads to the player as the
// button doing nothing at all. This drives the store action through the real RPC
// layer and asserts on what gets emitted.

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))

vi.mock('@/api/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/internal')>()
  return {
    ...actual,
    getAuthenticatedSocket: vi.fn(async () => ({ socket: { emit }, userId: 'player' }))
  }
})

import { useWorldStore } from '@/stores/world'
import { useCombatStore } from '@/stores/combat'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { rejectAllPending } from '@/api/actionRpc'
import { TM, CAPABILITY_END_TURN } from '@/api/protocol'

const ACTORS = [
  { _id: 'seelah', type: 'character', name: 'Seelah', ownership: { player: 3 } },
  { _id: 'goblin', type: 'npc', name: 'Goblin', ownership: {} },
  { _id: 'wolf', type: 'npc', name: 'Wolf', ownership: {} }
]

const COMBATANTS = [
  { _id: 'ca', actorId: 'seelah', initiative: 20 },
  { _id: 'cb', actorId: 'goblin', initiative: 15 },
  { _id: 'cc', actorId: 'wolf', initiative: 5 }
]

function loadWorld(
  userId: string,
  combat: Record<string, unknown>,
  combatants: Array<Record<string, unknown>> = COMBATANTS
) {
  useWorldStore().world = {
    userId,
    actors: ACTORS,
    users: [
      { _id: 'player', role: 1 },
      { _id: 'gm', role: 4 }
    ],
    messages: [],
    scenes: [{ _id: 'scene-1', active: true, tokens: [] }],
    combats: [{ _id: 'c1', active: true, scene: 'scene-1', ...combat, combatants }]
  } as unknown as GamePF2e
  useVersionCompatStore().reportModule(4, '1.0.0', [CAPABILITY_END_TURN])
}

// The one NEXT_TURN payload put on the wire, or undefined.
function sent() {
  const call = emit.mock.calls.find(([, args]) => args?.action === TM.NEXT_TURN)
  return call?.[1] as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  emit.mockClear()
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  rejectAllPending('test teardown')
})

describe('End Turn reaches the wire', () => {
  it('sends the round and turn the bar is showing', async () => {
    loadWorld('player', { round: 3, turn: 0 })
    const combat = useCombatStore()
    expect(combat.canEndTurn).toBe(true)
    combat.endTurn().catch(() => {})
    await vi.waitFor(() => expect(sent()).toBeDefined())
    expect(sent()).toMatchObject({
      action: TM.NEXT_TURN,
      actorId: 'seelah',
      combatId: 'c1',
      round: 3,
      turn: 0
    })
  })

  // The state a player is in right after the previous round rolled over: turn 0
  // of a fresh round. `turn: 0` is falsy, so any truthiness check on the way to
  // the wire would drop it and the module would refuse the request.
  it('sends turn 0 at the top of a round', async () => {
    loadWorld('player', { round: 4, turn: 0 })
    const combat = useCombatStore()
    combat.endTurn().catch(() => {})
    await vi.waitFor(() => expect(sent()).toBeDefined())
    expect(sent()).toMatchObject({ round: 4, turn: 0, actorId: 'seelah' })
  })

  it('sends the acting combatant, not the sheet being viewed', async () => {
    loadWorld('gm', { round: 3, turn: 1 })
    const combat = useCombatStore()
    expect(combat.canEndTurn).toBe(true)
    combat.endTurn().catch(() => {})
    await vi.waitFor(() => expect(sent()).toBeDefined())
    expect(sent()).toMatchObject({ actorId: 'goblin', turn: 1 })
  })

  // Rotation must not leak into the payload: the module compares `turn` against
  // its own index into the unrotated order.
  it('sends the unrotated turn index for a mid-round turn', async () => {
    loadWorld('player', { round: 3, turn: 2 })
    const combat = useCombatStore()
    // Wolf leads the rotated strip, but the wire still says index 2.
    expect(combat.turnOrder[0].name).toBe('Wolf')
    combat.endTurn().catch(() => {})
    await vi.waitFor(() => expect(sent()).toBeDefined())
    expect(sent()).toMatchObject({ actorId: 'wolf', turn: 2, round: 3 })
  })

  it('emits nothing when the encounter has not begun', async () => {
    loadWorld('player', { round: 0, turn: null })
    const combat = useCombatStore()
    expect(combat.canEndTurn).toBe(false)
    await expect(combat.endTurn()).rejects.toThrow(/no turn to end/)
    expect(sent()).toBeUndefined()
  })

  // A combatant with no actor is unendable — the request names the actor whose
  // turn it is. canEndTurn has to say so, or a GM gets a live button that
  // silently sends nothing.
  it('offers no button for a combatant with no actor', () => {
    loadWorld('gm', { round: 3, turn: 0 }, [{ _id: 'ca', initiative: 20 }])
    expect(useCombatStore().canEndTurn).toBe(false)
  })

  // Reaching this is a bug in the gating, so it must be loud: the component
  // turns a rejection into a visible message, and a quiet return would leave a
  // button that does nothing with nothing to show for it.
  it('throws rather than silently doing nothing when there is no turn to end', async () => {
    loadWorld('gm', { round: 3, turn: 0 }, [{ _id: 'ca', initiative: 20 }])
    await expect(useCombatStore().endTurn()).rejects.toThrow(/no turn to end/)
    expect(sent()).toBeUndefined()
  })
})
