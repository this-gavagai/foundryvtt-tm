// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyChatMessage } from '../pushNotify'

// The audience split is what keeps a whisper clear of ambient table chat, so
// these tests drive notifyChatMessage end to end and assert on the payload the
// relay actually receives: who is notified at all, and which of them are marked
// `direct` (own rate-limit bucket, no banner collapsing, no active-user
// suppression — see relay/src/index.ts).

const pushConfig = {
  relayUrl: 'https://relay.example',
  worldId: 'world-1',
  worldKey: 'key',
  includeBody: true,
  scope: 'mentions' as 'mentions' | 'all'
}

vi.mock('../pushRegistration', () => ({ readPushConfig: () => pushConfig }))
vi.mock('../transcriptionSetting', () => ({ transcriptionEnabled: () => false }))

type TestUser = { id: string; name: string; active?: boolean; belongsTo?: string }

let fetchMock: ReturnType<typeof vi.fn>

// `primaryGm` is the world's elected sender; `me` is the client running this
// code. They differ only in the leader-election tests.
function setWorld(list: TestUser[], ids: { primaryGm?: string; me?: string } = {}) {
  const primaryGm = ids.primaryGm ?? 'gm'
  const me = ids.me ?? primaryGm
  const byId = new Map(list.map((u) => [u.id, u]))
  ;(globalThis as Record<string, unknown>).game = {
    user: { id: me, _id: me, isGM: true },
    users: {
      activeGM: { id: primaryGm },
      contents: list.map((u) => ({
        id: u.id,
        name: u.name,
        flags: u.belongsTo ? { tablemate: { belongsTo: u.belongsTo } } : {}
      })),
      get: (id: string) => byId.get(id)
    },
    actors: { get: () => undefined },
    world: { title: 'Test World', id: 'test' }
  }
}

function message(over: Record<string, unknown> = {}) {
  return { id: 'msg1', alias: 'Seelah', content: '<p>hello</p>', author: { id: 'alice', name: 'Alice' }, ...over }
}

// The single /notify payload, or undefined when nothing was sent.
function payload() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/notify'))
  return call ? (JSON.parse((call[1] as RequestInit).body as string) as { recipients: string[]; direct: string[] }) : undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  pushConfig.scope = 'mentions'
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  setWorld([
    { id: 'gm', name: 'GameMaster' },
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'carol', name: 'Carol' }
  ])
})

describe('audience classification', () => {
  it('marks whisper targets direct and gives them no ambient company', async () => {
    await notifyChatMessage(message({ whisper: ['bob'] }))
    expect(payload()).toMatchObject({ recipients: ['bob'], direct: ['bob'] })
  })

  it('marks a mentioned user direct on the default scope', async () => {
    await notifyChatMessage(message({ content: '<p>Bob, look out</p>' }))
    expect(payload()).toMatchObject({ recipients: ['bob'], direct: ['bob'] })
  })

  it('sends nothing when a public message names nobody on the default scope', async () => {
    await notifyChatMessage(message())
    expect(payload()).toBeUndefined()
  })

  it("splits a mention out of the table's ambient audience on scope 'all'", async () => {
    pushConfig.scope = 'all'
    await notifyChatMessage(message({ content: '<p>Bob, look out</p>' }))
    const sent = payload()!
    expect(sent.direct).toEqual(['bob'])
    // Everyone else who can see it is notified too, but as ambient.
    expect(sent.recipients.slice().sort()).toEqual(['bob', 'carol', 'gm'])
  })

  it("notifies the whole table as ambient on scope 'all' with no mention", async () => {
    pushConfig.scope = 'all'
    await notifyChatMessage(message())
    const sent = payload()!
    expect(sent.direct).toEqual([])
    expect(sent.recipients.slice().sort()).toEqual(['bob', 'carol', 'gm'])
  })

  it('never notifies the author or a user they own', async () => {
    pushConfig.scope = 'all'
    setWorld([
      { id: 'gm', name: 'GameMaster' },
      { id: 'alice', name: 'Alice' },
      { id: 'alice-app', name: 'AliceApp', belongsTo: 'alice' },
      { id: 'bob', name: 'Bob' }
    ])
    await notifyChatMessage(message())
    expect(payload()!.recipients.slice().sort()).toEqual(['bob', 'gm'])
  })

  it('notifies a user owned by a whisper target alongside them, also as direct', async () => {
    setWorld([
      { id: 'gm', name: 'GameMaster' },
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
      { id: 'bob-app', name: 'BobApp', belongsTo: 'bob' }
    ])
    await notifyChatMessage(message({ whisper: ['bob'] }))
    const sent = payload()!
    expect(sent.recipients.slice().sort()).toEqual(['bob', 'bob-app'])
    expect(sent.direct.slice().sort()).toEqual(['bob', 'bob-app'])
  })
})

describe('active-user suppression', () => {
  it('suppresses a connected user from ambient chat', async () => {
    pushConfig.scope = 'all'
    setWorld([
      { id: 'gm', name: 'GameMaster' },
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob', active: true },
      { id: 'carol', name: 'Carol' }
    ])
    await notifyChatMessage(message())
    expect(payload()!.recipients.slice().sort()).toEqual(['carol', 'gm'])
  })

  it('still notifies a connected user of a whisper', async () => {
    // Foundry lags a backgrounded app by tens of seconds, so `active` is not
    // evidence anyone is looking — a redundant banner beats a lost whisper.
    setWorld([
      { id: 'gm', name: 'GameMaster' },
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob', active: true }
    ])
    await notifyChatMessage(message({ whisper: ['bob'] }))
    expect(payload()).toMatchObject({ recipients: ['bob'], direct: ['bob'] })
  })

  it('still notifies a connected user who is mentioned', async () => {
    pushConfig.scope = 'all'
    setWorld([
      { id: 'gm', name: 'GameMaster' },
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob', active: true },
      { id: 'carol', name: 'Carol', active: true }
    ])
    await notifyChatMessage(message({ content: '<p>Bob, look out</p>' }))
    const sent = payload()!
    expect(sent.direct).toEqual(['bob'])
    // Carol is connected and only an ambient recipient, so she is still skipped.
    expect(sent.recipients).toEqual(['bob', 'gm'])
  })
})

describe('leader election and gating', () => {
  it('sends nothing from a client that is not the primary GM', async () => {
    setWorld(
      [
        { id: 'gm', name: 'GameMaster' },
        { id: 'alice', name: 'Alice' },
        { id: 'bob', name: 'Bob' }
      ],
      { primaryGm: 'gm', me: 'another-gm' }
    )
    await notifyChatMessage(message({ whisper: ['bob'] }))
    expect(payload()).toBeUndefined()
  })

  it('skips an unattributable message', async () => {
    await notifyChatMessage(message({ author: undefined, user: undefined, whisper: ['bob'] }))
    expect(payload()).toBeUndefined()
  })

  it('skips a message with neither text nor a roll', async () => {
    await notifyChatMessage(message({ content: '', whisper: ['bob'] }))
    expect(payload()).toBeUndefined()
  })
})
