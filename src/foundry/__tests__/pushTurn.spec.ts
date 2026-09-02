// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyTurnStart, resetTurnPushMemory } from '../pushTurn'

// A turn alert is the notification a player with their phone in their pocket
// actually wants, so the interesting cases are all about NOT sending it wrongly:
// to the GM for every goblin, twice for one turn, or for a combatant the GM is
// running off-screen. These drive notifyTurnStart end to end and assert on the
// payload the relay receives.

const pushConfig = {
  relayUrl: 'https://relay.example',
  worldId: 'world-1',
  worldKey: 'key',
  includeBody: false,
  scope: 'mentions' as 'mentions' | 'all',
  turnAlerts: true
}

vi.mock('../pushRegistration', () => ({
  readPushConfig: () => pushConfig,
  isPrimaryGM: () => {
    const game = (globalThis as Record<string, unknown>).game as {
      user?: { id?: string }
      users?: { activeGM?: { id?: string } | null }
    }
    const activeGmId = game?.users?.activeGM?.id
    return !!activeGmId && game.user?.id === activeGmId
  }
}))

type TestUser = { id: string; name: string; isGM?: boolean; belongsTo?: string }

const USERS: TestUser[] = [
  { id: 'gm', name: 'GameMaster', isGM: true },
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' }
]

let fetchMock: ReturnType<typeof vi.fn>

function setWorld(list: TestUser[] = USERS, ids: { primaryGm?: string; me?: string } = {}) {
  const primaryGm = ids.primaryGm ?? 'gm'
  const me = ids.me ?? primaryGm
  const byId = new Map(list.map((u) => [u.id, u]))
  ;(globalThis as Record<string, unknown>).game = {
    user: { id: me },
    users: {
      activeGM: { id: primaryGm },
      contents: list.map((u) => ({
        id: u.id,
        name: u.name,
        flags: u.belongsTo ? { tablemate: { belongsTo: u.belongsTo } } : {}
      })),
      get: (id: string) => byId.get(id)
    },
    world: { title: 'Test World', id: 'test' }
  }
}

// An encounter sitting on Alice's paladin, mid-round.
function combat(over: Record<string, unknown> = {}, combatant: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    active: true,
    started: true,
    round: 3,
    turn: 1,
    combatant: {
      name: 'Seelah',
      actorId: 'seelah',
      actor: { ownership: { alice: 3 }, img: 'systems/pf2e/icons/seelah.webp' },
      ...combatant
    },
    ...over
  }
}

function payload() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/notify'))
  return call
    ? (JSON.parse((call[1] as RequestInit).body as string) as {
        recipients: string[]
        direct: string[]
        title: string
        body: string
        messageId?: string
        portraitUrl?: string
      })
    : undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  resetTurnPushMemory()
  pushConfig.turnAlerts = true
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  setWorld()
})

describe('turn alerts', () => {
  it("notifies the character's owner when their turn starts", async () => {
    await notifyTurnStart(combat(), { turn: 1 })
    expect(payload()).toMatchObject({
      recipients: ['alice'],
      direct: ['alice'],
      title: 'Test World · Seelah',
      body: 'Your turn — round 3',
      portraitUrl: 'systems/pf2e/icons/seelah.webp'
    })
  })

  // The app deep-links a notification tap to whatever message id it is handed,
  // and there is no chat message behind a turn alert.
  it('names no chat message', async () => {
    await notifyTurnStart(combat(), { turn: 1 })
    expect(payload()?.messageId).toBeUndefined()
  })

  // Foundry considers a GM the owner of every actor in the world, so an
  // ownership answer that went by role would buzz the GM for every monster.
  it("does not notify the GM about an NPC's turn", async () => {
    await notifyTurnStart(combat({}, { name: 'Goblin', actor: { ownership: {} } }), { turn: 1 })
    expect(payload()).toBeUndefined()
  })

  it('notifies a companion-app user alongside the owner it belongs to', async () => {
    setWorld([...USERS, { id: 'alice-phone', name: 'Alice (app)', belongsTo: 'alice' }])
    await notifyTurnStart(combat(), { turn: 1 })
    expect(payload()?.recipients.sort()).toEqual(['alice', 'alice-phone'])
  })

  it('notifies every owner of a shared character', async () => {
    await notifyTurnStart(combat({}, { actor: { ownership: { alice: 3, bob: 3 } } }), { turn: 1 })
    expect(payload()?.recipients.sort()).toEqual(['alice', 'bob'])
  })

  it('honours default ownership', async () => {
    await notifyTurnStart(combat({}, { actor: { ownership: { default: 3 } } }), { turn: 1 })
    expect(payload()?.recipients.sort()).toEqual(['alice', 'bob'])
  })

  it('ignores an observer who is not an owner', async () => {
    await notifyTurnStart(combat({}, { actor: { ownership: { alice: 2 } } }), { turn: 1 })
    expect(payload()).toBeUndefined()
  })
})

describe('what does not trigger an alert', () => {
  it('sends nothing when the world has turn alerts off', async () => {
    pushConfig.turnAlerts = false
    await notifyTurnStart(combat(), { turn: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // PF2e re-updates the encounter as its own turn automation runs, and a GM
  // stepping back and forth re-fires the hook on a turn already announced.
  it('sends one alert per turn, however many updates arrive', async () => {
    await notifyTurnStart(combat(), { turn: 1 })
    await notifyTurnStart(combat(), { round: 3 })
    await notifyTurnStart(combat(), { turn: 1 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('alerts again once the turn actually moves on', async () => {
    await notifyTurnStart(combat(), { turn: 1 })
    await notifyTurnStart(combat({ round: 4 }), { round: 4, turn: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Only one client may send, or a table with three GM browsers sends three.
  it('sends nothing from a GM client that is not the primary', async () => {
    setWorld(USERS, { primaryGm: 'gm', me: 'other-gm' })
    await notifyTurnStart(combat(), { turn: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores an encounter update that did not change the turn', async () => {
    await notifyTurnStart(combat(), { 'flags.pf2e.someOtherThing': 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores an encounter that has not begun', async () => {
    await notifyTurnStart(combat({ started: false, round: 0, turn: null }), { turn: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores an encounter that is not the active one', async () => {
    await notifyTurnStart(combat({ active: false }), { turn: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The GM is running this one off-screen; its owner is not meant to know.
  it('stays quiet for a hidden combatant', async () => {
    await notifyTurnStart(combat({}, { hidden: true }), { turn: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stays quiet for a defeated combatant', async () => {
    await notifyTurnStart(combat({}, { defeated: true }), { turn: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // A push failure must never surface as a rejection into the encounter's own
  // update. 401 rather than a network error because the shared delivery layer
  // retries transport failures over several seconds (see pushDelivery), and
  // that schedule is pinned by pushNotify's own specs.
  it('swallows a relay refusal instead of throwing into the hook', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }))
    await expect(notifyTurnStart(combat(), { turn: 1 })).resolves.toBeUndefined()
  })
})
