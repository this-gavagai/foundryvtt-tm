// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyChatMessage, lastPushDeliveryIssue } from '../pushNotify'

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

// isPrimaryGM lives in pushRegistration (one election shared with the identity
// minting), so the mock reproduces it against the fake world set up below.
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
    await notifyChatMessage(message({ content: '<p>@Bob, look out</p>' }))
    expect(payload()).toMatchObject({ recipients: ['bob'], direct: ['bob'] })
  })

  it('sends nothing when a public message names nobody on the default scope', async () => {
    await notifyChatMessage(message())
    expect(payload()).toBeUndefined()
  })

  it("splits a mention out of the table's ambient audience on scope 'all'", async () => {
    pushConfig.scope = 'all'
    await notifyChatMessage(message({ content: '<p>@Bob, look out</p>' }))
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

  it('treats the app user who caused a GM-executed roll as its sender', async () => {
    pushConfig.scope = 'all'
    setWorld([
      { id: 'gm', name: 'GameMaster' },
      { id: 'alice', name: 'Alice' },
      { id: 'alice-app', name: 'AliceApp', belongsTo: 'alice' },
      { id: 'bob', name: 'Bob' }
    ])
    // A roll made from Alice's app runs on the GM's client, so PF2e authors the
    // message as the GM; the listener stamps who actually asked for it.
    await notifyChatMessage(
      message({
        content: '',
        rolls: [{ total: 18 }],
        author: { id: 'gm', name: 'GameMaster' },
        flags: { tablemate: { originUserId: 'alice' } }
      })
    )
    // Alice made the roll, so neither she nor her app-user hears about it — and
    // the GM, who merely executed it, does.
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

describe('mention matching', () => {
  async function mentionsOf(content: string, list?: TestUser[]) {
    if (list) setWorld(list)
    await notifyChatMessage(message({ content: `<p>${content}</p>` }))
    return payload()?.direct ?? []
  }

  it('requires the @ marker, so ordinary table talk does not ping', async () => {
    // A user named "Bear" used to be notified by every mention of a bear.
    expect(await mentionsOf('a bear bursts from the trees', [{ id: 'u1', name: 'Bear' }])).toEqual([])
    expect(await mentionsOf('ask the GM about it', [{ id: 'u1', name: 'GM' }])).toEqual([])
  })

  it('matches @name at the start, mid-sentence and before punctuation', async () => {
    const users = [{ id: 'bob', name: 'Bob' }]
    expect(await mentionsOf('@Bob you are up', users)).toEqual(['bob'])
    expect(await mentionsOf('hey @Bob look', users)).toEqual(['bob'])
    expect(await mentionsOf('over to @Bob.', users)).toEqual(['bob'])
  })

  it('is case-insensitive and matches accented names', async () => {
    expect(await mentionsOf('go on @renée', [{ id: 'u1', name: 'Renée' }])).toEqual(['u1'])
  })

  it('does not match a longer name that merely starts the same', async () => {
    expect(await mentionsOf('@Bobby is up', [{ id: 'bob', name: 'Bob' }])).toEqual([])
  })

  it('does not treat an email address as a mention', async () => {
    expect(await mentionsOf('mail me at me@bob.example', [{ id: 'bob', name: 'Bob' }])).toEqual([])
  })

  it('matches a multi-word username', async () => {
    expect(await mentionsOf('thanks @Game Master', [{ id: 'gm2', name: 'Game Master' }])).toEqual(['gm2'])
  })

  it('ignores a one-character username, which would match far too much', async () => {
    expect(await mentionsOf('rolling a @X now', [{ id: 'u1', name: 'X' }])).toEqual([])
  })

  it('matches several users in one message', async () => {
    const found = await mentionsOf('@Bob and @Carol, together', [
      { id: 'bob', name: 'Bob' },
      { id: 'carol', name: 'Carol' }
    ])
    expect(found.slice().sort()).toEqual(['bob', 'carol'])
  })

  it('reads through HTML rather than matching markup', async () => {
    expect(await mentionsOf('<em>@Bob</em> <strong>go</strong>', [{ id: 'bob', name: 'Bob' }])).toEqual(['bob'])
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
    await notifyChatMessage(message({ content: '<p>@Bob, look out</p>' }))
    const sent = payload()!
    expect(sent.direct).toEqual(['bob'])
    // Carol is connected and only an ambient recipient, so she is still skipped.
    expect(sent.recipients).toEqual(['bob', 'gm'])
  })
})

describe('delivery retries', () => {
  // A push is a one-shot — nothing downstream ever re-sends — so a transient
  // failure used to lose the notification permanently.
  const notifyCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/notify')).length

  // Retries wait seconds; drive them rather than sleeping through them.
  async function runWithRetries(msg: Record<string, unknown>) {
    vi.useFakeTimers()
    try {
      const done = notifyChatMessage(msg)
      await vi.advanceTimersByTimeAsync(30_000)
      await done
    } finally {
      vi.useRealTimers()
    }
  }

  it('retries a 5xx and delivers on the retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 503 }))
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(2)
  })

  it('retries a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(2)
  })

  it('retries a 429', async () => {
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(2)
  })

  it('gives up after three attempts rather than retrying forever', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }))
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(3)
  })

  it('does not retry a 401 — a wrong world key is not transient', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }))
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(1)
  })

  it('does not retry a 400', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"bad"}', { status: 400 }))
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(1)
  })

  it('sends once when the first attempt succeeds', async () => {
    await runWithRetries(message({ whisper: ['bob'] }))
    expect(notifyCalls()).toBe(1)
  })
})

describe('reporting a shortfall the relay hid under a 200', () => {
  // The relay must answer 200 when only *part* of a message got through — a
  // retry would double-notify whoever did hear it — so it describes the
  // shortfall in the body instead. Nothing surfaced any of it, which meant a
  // table too big for one relay invocation looked exactly like a healthy one.
  const relayAnswers = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))

  // The record is module state that outlives a test, so identity-compare it:
  // recordDeliveryIssue always assigns a fresh object, so "unchanged" means this
  // delivery reported nothing.
  async function issueFrom(body: unknown, status = 200) {
    const before = lastPushDeliveryIssue()
    relayAnswers(body, status)
    await notifyChatMessage(message({ whisper: ['bob'] }))
    const after = lastPushDeliveryIssue()
    return after === before ? null : after
  }

  it('reports recipients shed to the subrequest budget', async () => {
    const issue = await issueFrom({
      results: [{ userId: 'bob', skipped: 'send budget exhausted' }],
      budgetExhausted: true
    })
    expect(issue?.detail).toContain('1 recipient(s) not notified')
    expect(issue?.detail).toContain('send budget exhausted')
  })

  it('reports recipients shed to a rate limit', async () => {
    const issue = await issueFrom({
      results: [
        { userId: 'bob', class: 'ambient', skipped: 'rate limited' },
        { userId: 'carol', class: 'ambient', skipped: 'rate limited' }
      ]
    })
    expect(issue?.detail).toContain('2 recipient(s) not notified (rate limited)')
  })

  it('reports a recipient whose send failed', async () => {
    const issue = await issueFrom({ results: [{ userId: 'bob', status: 400, ok: false }] })
    expect(issue?.detail).toContain('1 recipient(s) failed to deliver')
  })

  it('reports recipients dropped for exceeding the per-message limit', async () => {
    const issue = await issueFrom({ results: [{ userId: 'bob', ok: true }], droppedRecipients: 12 })
    expect(issue?.detail).toContain("12 recipient(s) over the relay's per-message limit")
  })

  it('stays quiet about deduping and Android, which cost nobody a notification', async () => {
    // One phone registered under two of a world's users is deduped to a single
    // banner; an Android registration was never going to be delivered to. Both
    // arrive as `skipped`, and neither is a problem to report.
    const issue = await issueFrom({
      results: [
        { userId: 'bob', ok: true },
        { userId: 'bob-app', skipped: 'device already notified' },
        { userId: 'carol', platform: 'android', skipped: 'non-ios not wired yet' }
      ]
    })
    expect(issue).toBeNull()
  })

  it('says nothing when everything was delivered', async () => {
    expect(await issueFrom({ results: [{ userId: 'bob', status: 200, ok: true }] })).toBeNull()
  })

  it('reports a relay that refused the message outright', async () => {
    const issue = await issueFrom({ error: 'unauthorized' }, 401)
    expect(issue?.detail).toContain('401')
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

describe('notification body', () => {
  // payload() is typed to the audience fields these tests don't use.
  function body(): string | undefined {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/notify'))
    return call ? (JSON.parse((call[1] as RequestInit).body as string) as { body: string }).body : undefined
  }

  it('summarises a text-less roll instead of saying "sent a message"', async () => {
    await notifyChatMessage(
      message({ content: '', rolls: [{ total: 23 }], flavor: '<h4>Athletics Check</h4>', whisper: ['bob'] })
    )
    expect(body()).toBe('🎲 Athletics Check: 23')
  })

  it('falls back to the total when the roll has no flavour', async () => {
    await notifyChatMessage(message({ content: '', rolls: [{ total: 17 }], whisper: ['bob'] }))
    expect(body()).toBe('🎲 17')
  })

  it('says a roll was made without disclosing it when message text is off', async () => {
    pushConfig.includeBody = false
    try {
      await notifyChatMessage(
        message({ content: '', rolls: [{ total: 23 }], flavor: '<h4>Athletics Check</h4>', whisper: ['bob'] })
      )
      expect(body()).toBe('made a roll')
    } finally {
      pushConfig.includeBody = true
    }
  })
})
