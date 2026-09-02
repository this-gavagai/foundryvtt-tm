// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'

import { useWorldStore } from '@/stores/world'
import { useCombatStore } from '@/stores/combat'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { CAPABILITY_END_TURN } from '@/api/protocol'

// `combat.turn` is an INDEX into the sorted turn order, and the world dump
// carries combatants in creation order — so the app has to reproduce the
// Foundry-side sort or the turn bar points at the wrong combatant. These pin
// that sort (including PF2e's tiebreak, which is the part with no obvious
// answer) and the ownership rule behind "your turn".

const USERS = [
  { _id: 'player', role: 1 },
  { _id: 'other', role: 1 },
  { _id: 'gm', role: 4 }
]

const ACTORS = [
  { _id: 'seelah', type: 'character', name: 'Seelah', ownership: { player: 3 } },
  { _id: 'kyra', type: 'character', name: 'Kyra', ownership: { other: 3 } },
  { _id: 'goblin', type: 'npc', name: 'Goblin', ownership: {} },
  { _id: 'wolf', type: 'npc', name: 'Wolf', ownership: {} }
]

type Combatant = Record<string, unknown>

function loadWorld(
  userId: string,
  combat: Record<string, unknown> | undefined,
  combatants: Combatant[] = []
) {
  useWorldStore().world = {
    userId,
    actors: ACTORS,
    users: USERS,
    messages: [],
    scenes: [{ _id: 'scene-1', active: true, tokens: [] }],
    combats: combat ? [{ _id: 'c1', active: true, scene: 'scene-1', ...combat, combatants }] : []
  } as unknown as GamePF2e
}

// An encounter mid-flight, on `turn`.
//
// Deliberately carries NO `started` field: `Combat#started` is a getter on the
// live document and appears nowhere in a world's saved encounters, so a fixture
// that set it would pass while the real payload made every encounter read as
// "Not started". The store derives it from round + combatants, and these
// fixtures are shaped like what actually arrives.
function encounter(turn: number, round = 3) {
  return { active: true, round, turn }
}

beforeEach(() => {
  // versionCompat reports the app's build version, injected by Vite.
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('turn order', () => {
  it('sorts by initiative descending, whatever order the dump arrives in', () => {
    loadWorld('player', encounter(0), [
      { _id: 'a', actorId: 'goblin', initiative: 12 },
      { _id: 'b', actorId: 'seelah', initiative: 21 },
      { _id: 'c', actorId: 'kyra', initiative: 17 }
    ])
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual(['Seelah', 'Kyra', 'Goblin'])
  })

  it('puts combatants who have not rolled at the end', () => {
    loadWorld('player', encounter(0), [
      { _id: 'a', actorId: 'goblin', initiative: null },
      { _id: 'b', actorId: 'seelah', initiative: 4 }
    ])
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual(['Seelah', 'Goblin'])
  })

  // PF2e's tiebreak: on an exact tie the lower priority acts first, and priority
  // is 1 for a creature with no player owner, 2 for one with. So the monster
  // goes before the party member — the rule the system implements, and the one
  // a turn bar sorted by initiative alone gets backwards.
  it('breaks an exact initiative tie in favour of the NPC', () => {
    loadWorld('player', encounter(0), [
      { _id: 'zzz-pc', actorId: 'seelah', initiative: 15 },
      { _id: 'aaa-npc', actorId: 'goblin', initiative: 15 }
    ])
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual(['Goblin', 'Seelah'])
  })

  // A GM who drags tied combatants into an explicit order gets that order
  // recorded per initiative value on the combatant, and it outranks the
  // creature-type tiebreak.
  it('honours a GM-set override priority over the tiebreak', () => {
    loadWorld('player', encounter(0), [
      {
        _id: 'pc',
        actorId: 'seelah',
        initiative: 15,
        flags: { pf2e: { overridePriority: { 15: 0 } } }
      },
      {
        _id: 'npc',
        actorId: 'goblin',
        initiative: 15,
        flags: { pf2e: { overridePriority: { 15: 1 } } }
      }
    ])
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual(['Seelah', 'Goblin'])
  })

  it('falls back to combatant id when two NPCs tie', () => {
    loadWorld('player', encounter(0), [
      { _id: 'b', actorId: 'wolf', initiative: 9 },
      { _id: 'a', actorId: 'goblin', initiative: 9 }
    ])
    expect(useCombatStore().turnOrder.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('names a combatant from its token when the combatant itself is unnamed', () => {
    useWorldStore().world = {
      userId: 'player',
      actors: ACTORS,
      users: USERS,
      messages: [],
      scenes: [{ _id: 'scene-1', active: true, tokens: [{ _id: 't1', name: 'Goblin Sniper' }] }],
      combats: [
        {
          _id: 'c1',
          scene: 'scene-1',
          ...encounter(0),
          combatants: [{ _id: 'a', actorId: 'goblin', tokenId: 't1', initiative: 10 }]
        }
      ]
    } as unknown as GamePF2e
    expect(useCombatStore().turnOrder[0].name).toBe('Goblin Sniper')
  })
})

describe('whose turn it is', () => {
  const combatants = [
    { _id: 'a', actorId: 'seelah', initiative: 20 },
    { _id: 'b', actorId: 'goblin', initiative: 15 },
    { _id: 'c', actorId: 'kyra', initiative: 10 }
  ]

  it('marks the combatant at the turn index as current', () => {
    loadWorld('player', encounter(1), combatants)
    const store = useCombatStore()
    expect(store.currentCombatant?.name).toBe('Goblin')
    expect(store.turnOrder.filter((e) => e.isCurrent).map((e) => e.name)).toEqual(['Goblin'])
  })

  it('reports your turn only for an actor you own', () => {
    loadWorld('player', encounter(0), combatants)
    expect(useCombatStore().isMyTurn).toBe(true)
    loadWorld('player', encounter(2), combatants)
    expect(useCombatStore().isMyTurn).toBe(false)
  })

  // A GM owns every actor in Foundry's model, so a role-based answer would
  // announce every goblin's turn as the GM's own.
  it('does not report an NPC turn as the GM their own', () => {
    loadWorld('gm', encounter(1), combatants)
    const store = useCombatStore()
    expect(store.isMyTurn).toBe(false)
    // They may still end it — a GM advances the tracker for anyone.
    useVersionCompatStore().reportModule(4, '1.0.0', [CAPABILITY_END_TURN])
    expect(store.canEndTurn).toBe(true)
  })

  // Round 0 with `turn: null` is what a tracker looks like after the GM adds
  // combatants and before they press "Begin Encounter".
  it('offers no current turn before the encounter has begun', () => {
    loadWorld('player', { active: true, round: 0, turn: null }, combatants)
    const store = useCombatStore()
    expect(store.started).toBe(false)
    expect(store.currentCombatant).toBeUndefined()
    expect(store.turnOrder.every((e) => !e.isCurrent)).toBe(true)
  })

  // The regression this pins: a live encounter arrives with round/turn set and
  // no `started` field at all, and must not read as "Not started".
  it('reads a live encounter as started from round and combatants alone', () => {
    loadWorld('player', { active: true, round: 1, turn: 0 }, combatants)
    const store = useCombatStore()
    expect(store.started).toBe(true)
    expect(store.currentCombatant?.name).toBe('Seelah')
  })

  // Round 0 is the only "not begun" signal, and an encounter with nothing in it
  // cannot have a turn no matter what round it claims.
  it('is not started with no combatants', () => {
    loadWorld('player', { active: true, round: 2, turn: 0 }, [])
    expect(useCombatStore().started).toBe(false)
  })

  it('hides the End Turn button when the module cannot serve it', () => {
    loadWorld('player', encounter(0), combatants)
    expect(useCombatStore().canEndTurn).toBe(false)
    useVersionCompatStore().reportModule(4, '1.0.0', [CAPABILITY_END_TURN])
    expect(useCombatStore().canEndTurn).toBe(true)
  })
})

describe('hidden combatants', () => {
  const combatants = [
    { _id: 'a', actorId: 'seelah', initiative: 20 },
    { _id: 'b', actorId: 'goblin', initiative: 15, hidden: true },
    { _id: 'c', actorId: 'kyra', initiative: 10 }
  ]

  // Dropped from the STRIP, but only after the sort and the rotation — the
  // current-turn index counts hidden combatants, so filtering first would
  // rotate around the wrong pivot and shift every row.
  it('keeps the turn index right while hiding the row from a player', () => {
    loadWorld('player', encounter(2), combatants)
    const store = useCombatStore()
    // Kyra is up (index 2), so she leads; Seelah wraps into the next round and
    // the hidden Goblin between them is simply gone.
    expect(store.turnOrder.map((e) => e.name)).toEqual(['Kyra', 'Seelah'])
    expect(store.currentCombatant?.name).toBe('Kyra')
    expect(store.turnOrder.filter((e) => e.isCurrent).map((e) => e.name)).toEqual(['Kyra'])
  })

  it('marks nobody current while a hidden combatant holds the turn', () => {
    loadWorld('player', encounter(1), combatants)
    const store = useCombatStore()
    expect(store.turnOrder.some((e) => e.isCurrent)).toBe(false)
    // The store still knows, so "is it mine" stays answerable.
    expect(store.currentCombatant?.name).toBe('Goblin')
    expect(store.isMyTurn).toBe(false)
  })

  it('shows a hidden combatant to a GM', () => {
    loadWorld('gm', encounter(1), combatants)
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual(['Goblin', 'Kyra', 'Seelah'])
  })

  // The divider marks where this round ends. With the top of the initiative
  // order hidden from this user, it has to move to the first entry they can
  // actually see — pinning it to the hidden combatant would lose it entirely.
  it('moves the round divider past a hidden top-of-order combatant', () => {
    loadWorld('player', encounter(2), [
      { _id: 'a', actorId: 'seelah', initiative: 20, hidden: true },
      { _id: 'b', actorId: 'goblin', initiative: 15 },
      { _id: 'c', actorId: 'kyra', initiative: 10 }
    ])
    const order = useCombatStore().turnOrder
    // Kyra leads; Seelah (top of order, so next round) is hidden, which leaves
    // the Goblin as the first next-round entry this player can see.
    expect(order.map((e) => e.name)).toEqual(['Kyra', 'Goblin'])
    expect(order.filter((e) => e.startsNewRound).map((e) => e.name)).toEqual(['Goblin'])
  })
})

describe('rotation and the round divider', () => {
  const combatants = [
    { _id: 'a', actorId: 'seelah', initiative: 20 },
    { _id: 'b', actorId: 'goblin', initiative: 15 },
    { _id: 'c', actorId: 'kyra', initiative: 10 },
    { _id: 'd', actorId: 'wolf', initiative: 5 }
  ]

  // The whole point: read left to right and the strip is "acting now, then
  // next, then next" rather than an initiative list to hunt through.
  it('puts whoever is up at the left edge', () => {
    loadWorld('player', encounter(2), combatants)
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual([
      'Kyra',
      'Wolf',
      'Seelah',
      'Goblin'
    ])
  })

  it('rotates by one as the turn advances', () => {
    loadWorld('player', encounter(3), combatants)
    expect(useCombatStore().turnOrder.map((e) => e.name)).toEqual([
      'Wolf',
      'Seelah',
      'Goblin',
      'Kyra'
    ])
  })

  it('shows exactly one cycle, however far into the round', () => {
    loadWorld('player', encounter(3), combatants)
    expect(useCombatStore().turnOrder).toHaveLength(combatants.length)
  })

  it('marks the wrapped combatant as the start of the next round', () => {
    loadWorld('player', encounter(2), combatants)
    const order = useCombatStore().turnOrder
    expect(order.filter((e) => e.startsNewRound).map((e) => e.name)).toEqual(['Seelah'])
  })

  // Nothing of the next round is on screen yet, so there is no boundary to draw.
  it('draws no divider while the top of the order is up', () => {
    loadWorld('player', encounter(0), combatants)
    const order = useCombatStore().turnOrder
    expect(order.map((e) => e.name)).toEqual(['Seelah', 'Goblin', 'Kyra', 'Wolf'])
    expect(order.some((e) => e.startsNewRound)).toBe(false)
  })

  it('draws no divider, and does not rotate, before the encounter begins', () => {
    loadWorld('player', { active: true, round: 0, turn: null }, combatants)
    const order = useCombatStore().turnOrder
    expect(order.map((e) => e.name)).toEqual(['Seelah', 'Goblin', 'Kyra', 'Wolf'])
    expect(order.some((e) => e.startsNewRound)).toBe(false)
  })

  // The ring is still worth drawing after rotation: when the acting combatant
  // is hidden from this user, the leftmost chip is NOT the one who is up.
  it('leaves the current flag on the acting combatant alone', () => {
    loadWorld('player', encounter(2), combatants)
    const order = useCombatStore().turnOrder
    expect(order[0].isCurrent).toBe(true)
    expect(order.filter((e) => e.isCurrent)).toHaveLength(1)
  })
})

describe('no encounter', () => {
  it('renders nothing to base the bar on', () => {
    loadWorld('player', undefined)
    const store = useCombatStore()
    expect(store.activeCombat).toBeUndefined()
    expect(store.turnOrder).toEqual([])
    expect(store.currentCombatant).toBeUndefined()
    expect(store.canEndTurn).toBe(false)
  })
})
