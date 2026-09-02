// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import type { Ref } from 'vue'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

import { useWorldStore } from '@/stores/world'
import { useCombatStore } from '@/stores/combat'
import { setupSocketListenersForWorld } from '@/composables/serverEventWiring'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

// Encounter updates arrive as `modifyDocument` broadcasts, and the round/turn a
// player reads live on the COMBAT document — not on its combatants. These drive
// the real socket wiring so the reactivity path is covered end to end: a store
// spec alone assigns `world` wholesale and would pass over an in-place mutation
// that never reaches a computed.

// The registry is a plain Set of subscribers, so a test can be the socket.
const subs: Array<(args: DocumentSocketResponse) => void> = []
vi.mock('@/api/socketSetup', () => ({
  onModifyDocument: (handler: (args: DocumentSocketResponse) => void) => {
    subs.push(handler)
    return () => subs.splice(subs.indexOf(handler), 1)
  },
  // setupSocketListenersForWorld also registers this one; the rest of the
  // module's subscriptions belong to the socket-scoped setup, not this one.
  onUserActivity: () => () => {}
}))

function broadcast(args: Partial<DocumentSocketResponse> & { type: string }) {
  subs.forEach((h) => h(args as DocumentSocketResponse))
}

// One Combat document update, as Foundry broadcasts it.
function combatUpdate(changes: Record<string, unknown>) {
  broadcast({
    type: 'Combat',
    action: 'update',
    result: [{ _id: 'c1', ...changes }],
    operation: {}
  } as unknown as DocumentSocketResponse)
}

// A round boundary as Foundry actually delivers it: crossing one carries a
// non-zero worldTime delta, so the server writes the world clock too and sends
// BOTH responses as a `modifyDocumentBatch` rather than a single
// `modifyDocument`. The batch is fanned out in socketSetup, so from here it is
// two ordinary broadcasts — side effect first, the encounter's own update last.
function roundBoundary(changes: Record<string, unknown>) {
  broadcast({
    type: 'Setting',
    action: 'update',
    result: [{ _id: 'core.time', value: '18' }],
    operation: {}
  } as unknown as DocumentSocketResponse)
  combatUpdate(changes)
}

// One Combatant update, e.g. PF2e stamping flags.pf2e.roundOfLastTurn.
function combatantUpdate(id: string, changes: Record<string, unknown>) {
  broadcast({
    type: 'Combatant',
    action: 'update',
    result: [{ _id: id, ...changes }],
    operation: { parentUuid: 'Combat.c1' }
  } as unknown as DocumentSocketResponse)
}

const ACTORS = [
  { _id: 'seelah', type: 'character', name: 'Seelah', ownership: { player: 3 } },
  { _id: 'goblin', type: 'npc', name: 'Goblin', ownership: {} },
  { _id: 'wolf', type: 'npc', name: 'Wolf', ownership: {} }
]

let world: Ref<GamePF2e | undefined>

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  subs.length = 0
  setActivePinia(createPinia())
  localStorage.clear()

  const store = useWorldStore()
  store.world = {
    userId: 'player',
    actors: ACTORS,
    users: [
      { _id: 'player', role: 1 },
      { _id: 'gm', role: 4 }
    ],
    messages: [],
    scenes: [{ _id: 'scene-1', active: true, tokens: [] }],
    combats: [
      {
        _id: 'c1',
        active: true,
        scene: 'scene-1',
        round: 3,
        // Wolf, last in initiative order, is up.
        turn: 2,
        combatants: [
          { _id: 'ca', actorId: 'seelah', initiative: 20 },
          { _id: 'cb', actorId: 'goblin', initiative: 15 },
          { _id: 'cc', actorId: 'wolf', initiative: 5 }
        ]
      }
    ]
  } as unknown as GamePF2e

  // The wiring and the store must share ONE ref, as they do in the app —
  // `$state.world` is the unwrapped value and would silently no-op every
  // broadcast, so take the ref itself.
  world = storeToRefs(store).world as Ref<GamePF2e | undefined>
  setupSocketListenersForWorld(world)
})

describe('turn advancing within a round', () => {
  it('follows a plain turn change', () => {
    const combat = useCombatStore()
    expect(combat.currentCombatant?.name).toBe('Wolf')
    combatUpdate({ turn: 1 })
    expect(combat.currentCombatant?.name).toBe('Goblin')
    expect(combat.turnOrder.map((e) => e.name)).toEqual(['Goblin', 'Wolf', 'Seelah'])
  })
})

describe('the last actor ending their turn', () => {
  // Foundry's nextTurn() delegates to nextRound() on the last combatant, so
  // round and turn change together in ONE Combat update, with no combatant
  // touched. That is the case that has to work on its own.
  it('follows a round rollover', () => {
    const combat = useCombatStore()
    combatUpdate({ round: 4, turn: 0 })
    expect(combat.round).toBe(4)
    expect(combat.currentCombatant?.name).toBe('Seelah')
    expect(combat.turnOrder.map((e) => e.name)).toEqual(['Seelah', 'Goblin', 'Wolf'])
    expect(combat.turnOrder.some((e) => e.startsNewRound)).toBe(false)
  })

  // The regression the user hit: only ever at a round boundary, in either
  // direction, because that is exactly when the operation gains a side effect.
  it('follows a round rollover delivered as a batch', () => {
    const combat = useCombatStore()
    roundBoundary({ round: 4, turn: 0 })
    expect(combat.round).toBe(4)
    expect(combat.currentCombatant?.name).toBe('Seelah')
    expect(combat.turnOrder.map((e) => e.name)).toEqual(['Seelah', 'Goblin', 'Wolf'])
  })

  it('follows a rewind across a round boundary', () => {
    const combat = useCombatStore()
    expect(combat.turnOrder[0].name).toBe('Wolf')
    // previousRound from round 3 turn 0 lands on the last turn of round 2.
    combatUpdate({ turn: 0 })
    roundBoundary({ round: 2, turn: 2 })
    expect(combat.round).toBe(2)
    expect(combat.currentCombatant?.name).toBe('Wolf')
  })

  it('rotates back to the top of the order', () => {
    const combat = useCombatStore()
    expect(combat.turnOrder.map((e) => e.name)).toEqual(['Wolf', 'Seelah', 'Goblin'])
    combatUpdate({ round: 4, turn: 0 })
    expect(combat.turnOrder[0].name).toBe('Seelah')
    expect(combat.turnOrder[0].isCurrent).toBe(true)
  })

  // A combatant write landing afterwards used to be what made a Combat change
  // visible at all; it must not be what makes it visible.
  it('does not need a combatant write to become visible', () => {
    const combat = useCombatStore()
    combatUpdate({ round: 4, turn: 0 })
    const afterCombatOnly = combat.turnOrder.map((e) => e.name)
    combatantUpdate('ca', { flags: { pf2e: { roundOfLastTurn: 4 } } })
    expect(combat.turnOrder.map((e) => e.name)).toEqual(afterCombatOnly)
  })
})
