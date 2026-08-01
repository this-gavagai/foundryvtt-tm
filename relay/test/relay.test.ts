import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import worker from '../src/index'

// The Worker uses only web-standard APIs (crypto.subtle, fetch, Request/Response,
// btoa/atob), so we exercise its real fetch() handler in plain vitest with a
// Map-backed KV and a stubbed APNs — no Miniflare required. APNs is the only
// outbound call, so stubbing global fetch fully isolates these tests.

// KV can fail — the free plan's daily write allowance is finite, and hitting it
// must degrade rather than break delivery. These let a test make specific keys
// unwritable/unreadable; both reset in beforeEach.
let kvFailWrite: (key: string) => boolean = () => false
let kvFailRead: (key: string) => boolean = () => false

// Every KV operation is a subrequest on Workers, counted against the same
// per-request ceiling as fetch() — 50 on the free plan. Tally them so tests can
// assert the whole ceiling, not just the APNs half of it.
let kvOps = 0

function makeKV() {
  const store = new Map<string, string>()
  return {
    store,
    get: async (k: string) => {
      kvOps++
      if (kvFailRead(k)) throw new Error(`KV read failed: ${k}`)
      return store.get(k) ?? null
    },
    put: async (k: string, v: string) => {
      kvOps++
      if (kvFailWrite(k)) throw new Error(`KV write failed: ${k}`)
      store.set(k, v)
    },
    delete: async (k: string) => {
      kvOps++
      store.delete(k)
    },
  }
}

// The free plan's hard limit. Exceeding it doesn't degrade — the runtime throws
// mid-request and the whole notify 500s.
const SUBREQUEST_CEILING = 50

type TestEnv = {
  APNS_KEY: string
  APNS_KEY_ID: string
  APNS_TEAM_ID: string
  APNS_BUNDLE_ID: string
  APNS_ENV: string
  RELAY_TEST_SECRET: string
  TOKENS: ReturnType<typeof makeKV>
}

let apnsKeyPem = ''

// A real P-256 pkcs8 PEM so the Worker's ES256 JWT signing actually succeeds on
// the /notify success path.
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const b64 = Buffer.from(pkcs8).toString('base64')
  apnsKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`
})

let env: TestEnv
// Per-URL APNs response, overridable per test (default: success).
let apnsResponse: (url: string) => { status: number; body: string } = () => ({ status: 200, body: '' })
let apnsCalls: string[] = []
let apnsBodies: Array<{ aps?: { badge?: number }; [k: string]: unknown }> = []
let apnsHeaders: Array<Record<string, string>> = []

beforeEach(() => {
  env = {
    APNS_KEY: apnsKeyPem,
    APNS_KEY_ID: 'KEYID12345',
    APNS_TEAM_ID: 'TEAMID6789',
    APNS_BUNDLE_ID: 'io.github.thisgavagai.tablemate',
    APNS_ENV: 'sandbox',
    RELAY_TEST_SECRET: 'test-secret',
    TOKENS: makeKV(),
  }
  apnsResponse = () => ({ status: 200, body: '' })
  apnsCalls = []
  apnsBodies = []
  apnsHeaders = []
  kvFailWrite = () => false
  kvFailRead = () => false
  kvOps = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      apnsCalls.push(url)
      apnsHeaders.push((init?.headers ?? {}) as Record<string, string>)
      if (typeof init?.body === 'string') apnsBodies.push(JSON.parse(init.body))
      const { status, body } = apnsResponse(url)
      return new Response(body, { status, headers: { 'apns-id': 'test-apns-id' } })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

const b64url = (s: string) => Buffer.from(s).toString('base64url')

function mintToken(worldId: string, userId: string, key: string, exp = Math.floor(Date.now() / 1000) + 300) {
  const payload = b64url(JSON.stringify({ worldId, userId, exp }))
  const sig = createHmac('sha256', key).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(
    new Request(`https://relay.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env as never,
  )
}

async function provisionWorld(userIp = '1.1.1.1') {
  const worldPushId = randomUUID()
  const worldKey = randomUUID().replace(/-/g, '')
  const res = await post('/provision', { worldPushId, worldKey }, { 'CF-Connecting-IP': userIp })
  expect(res.status).toBe(200)
  return { worldPushId, worldKey }
}

async function registerDevice(
  worldPushId: string,
  worldKey: string,
  userId: string,
  deviceToken: string,
  serverBaseUrl?: string,
) {
  const res = await post('/register', {
    regToken: mintToken(worldPushId, userId, worldKey),
    deviceToken,
    platform: 'ios',
    serverBaseUrl,
  })
  expect(res.status).toBe(200)
  return res
}

describe('CORS', () => {
  it('answers OPTIONS preflight with 204 + headers', async () => {
    const res = await worker.fetch(new Request('https://relay.test/register', { method: 'OPTIONS' }), env as never)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('allows the browser to read the health probe', async () => {
    // The GM's reachability check runs in the Foundry page, which is never the
    // Worker's origin. Without this header the browser blocks the response and a
    // healthy relay reports as unreachable — see collectPushStatus.
    const res = await worker.fetch(new Request('https://relay.test/', { method: 'GET' }), env as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('/provision (TOFU)', () => {
  it('accepts a new world, is idempotent for the same key, rejects a different key', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    expect((await post('/provision', { worldPushId, worldKey })).status).toBe(200) // idempotent
    const conflict = await post('/provision', { worldPushId, worldKey: 'someone-elses-key' })
    expect(conflict.status).toBe(409) // cannot hijack a claimed world
  })

  it('requires worldPushId and worldKey', async () => {
    expect((await post('/provision', { worldPushId: 'x' })).status).toBe(400)
  })
})

describe('/register', () => {
  it('accepts a validly-minted reg token and stores the device', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain('devtokenA')
  })

  it('drops an abandoned registration while it is rewriting the list anyway', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'old-phone')
    const key = `tok:${worldPushId}:alice`
    const regs = JSON.parse(env.TOKENS.store.get(key)!)
    regs[0].updatedAt = Date.now() - 40 * 24 * 60 * 60 * 1000
    env.TOKENS.store.set(key, JSON.stringify(regs))

    await registerDevice(worldPushId, worldKey, 'alice', 'new-phone')
    const stored = JSON.parse(env.TOKENS.store.get(key)!) as Array<{ deviceToken: string }>
    // The replaced phone stops costing a subrequest on every delivery, without
    // waiting for a message to be sent first.
    expect(stored.map((r) => r.deviceToken)).toEqual(['new-phone'])
  })

  it('rejects a tampered token', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    const bad = mintToken(worldPushId, 'alice', worldKey).slice(0, -1) + 'X'
    expect((await post('/register', { regToken: bad, deviceToken: 'd', platform: 'ios' })).status).toBe(401)
  })

  it('rejects a token signed with the wrong key', async () => {
    const { worldPushId } = await provisionWorld()
    const forged = mintToken(worldPushId, 'alice', 'wrong-key')
    expect((await post('/register', { regToken: forged, deviceToken: 'd', platform: 'ios' })).status).toBe(401)
  })

  it('rejects registration for an unprovisioned world', async () => {
    const orphan = mintToken(randomUUID(), 'alice', 'k')
    expect((await post('/register', { regToken: orphan, deviceToken: 'd', platform: 'ios' })).status).toBe(401)
  })

  it('rejects with neither a reg token nor the admin bearer', async () => {
    expect((await post('/register', { deviceToken: 'd', platform: 'ios' })).status).toBe(401)
  })
})

describe('/unregister', () => {
  it('stops delivery to the named device and is idempotent', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')

    const first = await post('/unregister', { worldId: worldPushId, userId: 'alice', deviceToken: 'devtokenA' })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ removed: 1, registrations: 0 })

    apnsCalls = []
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsCalls.length).toBe(0)

    // Unregistering again is a no-op success, not an error.
    const second = await post('/unregister', { worldId: worldPushId, userId: 'alice', deviceToken: 'devtokenA' })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ removed: 0 })
  })

  it('accepts a regToken instead of an explicit world/user', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    const res = await post('/unregister', {
      regToken: mintToken(worldPushId, 'alice', worldKey),
      deviceToken: 'devtokenA',
    })
    expect(await res.json()).toMatchObject({ removed: 1 })
  })

  it('rejects a regToken signed with the wrong key', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    const res = await post('/unregister', {
      regToken: mintToken(worldPushId, 'alice', 'wrong-key'),
      deviceToken: 'devtokenA',
    })
    expect(res.status).toBe(401)
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain('devtokenA')
  })

  it('leaves the same device registered in other worlds and other devices in this one', async () => {
    const a = await provisionWorld('1.1.1.1')
    const b = await provisionWorld('2.2.2.2')
    await registerDevice(a.worldPushId, a.worldKey, 'alice', 'phone')
    await registerDevice(b.worldPushId, b.worldKey, 'alice', 'phone')
    await registerDevice(a.worldPushId, a.worldKey, 'alice', 'tablet')

    // Alice removes world A from her phone only.
    await post('/unregister', { worldId: a.worldPushId, userId: 'alice', deviceToken: 'phone' })

    apnsCalls = []
    await post(
      '/notify',
      { worldId: a.worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${a.worldKey}` },
    )
    expect(apnsCalls.some((u) => u.includes('phone'))).toBe(false)
    expect(apnsCalls.some((u) => u.includes('tablet'))).toBe(true)

    apnsCalls = []
    await post(
      '/notify',
      { worldId: b.worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${b.worldKey}` },
    )
    expect(apnsCalls.some((u) => u.includes('phone'))).toBe(true)
  })

  it('requires a deviceToken, and a world/user without a regToken', async () => {
    expect((await post('/unregister', { worldId: 'w', userId: 'alice' })).status).toBe(400)
    expect((await post('/unregister', { deviceToken: 'd' })).status).toBe(400)
  })
})

describe('/notify authorisation + cross-world isolation', () => {
  it('rejects notify with the wrong world key', async () => {
    const { worldPushId } = await provisionWorld()
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: 'Bearer not-the-key' },
    )
    expect(res.status).toBe(401)
  })

  it('throttles a source that keeps guessing world keys', async () => {
    const { worldPushId } = await provisionWorld()
    const body = { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' }
    const headers = { authorization: 'Bearer wrong', 'CF-Connecting-IP': '9.9.9.9' }
    let last = 0
    for (let i = 0; i < 40; i++) last = (await post('/notify', body, headers)).status
    expect(last).toBe(429)
    // A legitimate caller from another address is unaffected, and never paid for
    // the counter in the first place.
    expect((await post('/notify', body, { authorization: 'Bearer wrong' })).status).toBe(401)
  })

  it('delivers only to the notified world; a device in another world is never contacted', async () => {
    const a = await provisionWorld('1.1.1.1')
    const b = await provisionWorld('2.2.2.2')
    await registerDevice(a.worldPushId, a.worldKey, 'alice', 'deviceInA')
    await registerDevice(b.worldPushId, b.worldKey, 'alice', 'deviceInB')

    // Notify world A for alice → only A's device is pushed.
    apnsCalls = []
    const res = await post(
      '/notify',
      { worldId: a.worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${a.worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.some((u) => u.includes('deviceInA'))).toBe(true)
    expect(apnsCalls.some((u) => u.includes('deviceInB'))).toBe(false)

    // Even with A's (valid) key, A cannot address B's namespace — B's key is required.
    const wrong = await post(
      '/notify',
      { worldId: b.worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${a.worldKey}` },
    )
    expect(wrong.status).toBe(401)
  })
})

describe('/notify delivery behaviour', () => {
  it('self-heals the environment: retries the other env and remembers it', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA') // stored env defaults to sandbox
    // sandbox fails as if the token were a production token; production succeeds.
    apnsResponse = (url) =>
      url.includes('sandbox')
        ? { status: 400, body: JSON.stringify({ reason: 'BadEnvironmentKeyInToken' }) }
        : { status: 200, body: '' }

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ ok: boolean; env: string }> }
    expect(json.results[0].ok).toBe(true)
    expect(json.results[0].env).toBe('production')
    // The stored registration's env is healed to production for next time.
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain('production')
  })

  it('prunes a dead token (410 in both environments)', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    apnsResponse = () => ({ status: 410, body: '' })

    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toBe('[]')
  })

  it('prunes an abandoned registration (updatedAt older than the stale window)', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    // Age the stored registration well past the 30-day stale window.
    const key = `tok:${worldPushId}:alice`
    const regs = JSON.parse(env.TOKENS.store.get(key)!)
    regs[0].updatedAt = Date.now() - 40 * 24 * 60 * 60 * 1000
    env.TOKENS.store.set(key, JSON.stringify(regs))

    apnsCalls = []
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsCalls.length).toBe(0) // never contacted
    expect(env.TOKENS.store.get(key)).toBe('[]') // and removed
  })

  it('forwards messageId as a custom apns key (via successful send)', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b', messageId: 'msg123' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.length).toBe(1)
  })

  it('stitches a relative portrait path onto the device’s own server base + sets mutable-content', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA', 'http://192.168.1.5:30001')
    await post(
      '/notify',
      {
        worldId: worldPushId,
        recipients: ['alice'],
        title: 't',
        body: 'b',
        portraitUrl: 'systems/pf2e/icons/iconics/tokens/seelah.webp',
      },
      { authorization: `Bearer ${worldKey}` },
    )
    const payload = apnsBodies[0] as { aps?: { 'mutable-content'?: number }; tmPortraitUrl?: string }
    expect(payload.tmPortraitUrl).toBe('http://192.168.1.5:30001/systems/pf2e/icons/iconics/tokens/seelah.webp')
    expect(payload.aps?.['mutable-content']).toBe(1)
  })

  it('resolves per device: two devices with different bases get different portrait URLs', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'lanPhone', 'http://192.168.1.5:30001')
    await registerDevice(worldPushId, worldKey, 'alice', 'tunnelPhone', 'https://foundry.example.com')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b', portraitUrl: 'worlds/x/art.webp' },
      { authorization: `Bearer ${worldKey}` },
    )
    const urls = apnsBodies.map((b) => (b as { tmPortraitUrl?: string }).tmPortraitUrl).sort()
    expect(urls).toEqual([
      'http://192.168.1.5:30001/worlds/x/art.webp',
      'https://foundry.example.com/worlds/x/art.webp',
    ])
  })

  it('passes an absolute external portrait URL through unchanged, ignoring the device base', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA', 'http://192.168.1.5:30001')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b', portraitUrl: 'https://cdn.example/art.png' },
      { authorization: `Bearer ${worldKey}` },
    )
    const payload = apnsBodies[0] as { tmPortraitUrl?: string }
    expect(payload.tmPortraitUrl).toBe('https://cdn.example/art.png')
  })

  it('omits the portrait (and mutable-content) for a relative path when the device sent no server base', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA') // no serverBaseUrl
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b', portraitUrl: 'systems/pf2e/art.webp' },
      { authorization: `Bearer ${worldKey}` },
    )
    const payload = apnsBodies[0] as { aps?: { 'mutable-content'?: number }; tmPortraitUrl?: string }
    expect(payload.tmPortraitUrl).toBeUndefined()
    expect(payload.aps?.['mutable-content']).toBeUndefined()
  })
})

describe('/status (GM diagnostic)', () => {
  it('reports provisioned plus a live device count per user', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA1')
    await registerDevice(worldPushId, worldKey, 'alice', 'devA2')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')

    const res = await post(
      '/status',
      { worldId: worldPushId, userIds: ['alice', 'bob', 'carol'] },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // Carol has no devices, so she is simply absent rather than reported as zero.
    expect(await res.json()).toEqual({
      ok: true,
      provisioned: true,
      devices: { alice: 2, bob: 1 },
      unsupported: 0,
      truncated: false,
    })
  })

  it('does not count an Android device as deliverable, but does report it', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await post('/register', {
      regToken: mintToken(worldPushId, 'bob', worldKey),
      deviceToken: 'devB',
      platform: 'android',
    })

    const res = await post(
      '/status',
      { worldId: worldPushId, userIds: ['alice', 'bob'] },
      { authorization: `Bearer ${worldKey}` },
    )
    // Bob is absent from `devices`: nothing would reach him, so the panel must not
    // promise a notification that cannot come.
    expect(await res.json()).toEqual({
      ok: true,
      provisioned: true,
      devices: { alice: 1 },
      unsupported: 1,
      truncated: false,
    })
  })

  it('caps the users it will read in one call and says the list was truncated', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'user0', 'dev0')
    kvOps = 0

    const res = await post(
      '/status',
      { worldId: worldPushId, userIds: Array.from({ length: 80 }, (_, i) => `user${i}`) },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // One KV read per user, so an unbounded list would blow the same ceiling
    // /notify faces; the caller chunks instead.
    expect(await res.json()).toMatchObject({ truncated: true, devices: { user0: 1 } })
    expect(kvOps).toBeLessThanOrEqual(SUBREQUEST_CEILING)
  })

  it('does not count a registration old enough to be pruned', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    const key = `tok:${worldPushId}:alice`
    const regs = JSON.parse(env.TOKENS.store.get(key)!)
    regs[0].updatedAt = Date.now() - 40 * 24 * 60 * 60 * 1000
    env.TOKENS.store.set(key, JSON.stringify(regs))

    const res = await post('/status', { worldId: worldPushId, userIds: ['alice'] }, { authorization: `Bearer ${worldKey}` })
    expect(await res.json()).toMatchObject({ devices: {} })
  })

  it('rejects a wrong key and an unknown world identically', async () => {
    const { worldPushId } = await provisionWorld()
    expect((await post('/status', { worldId: worldPushId }, { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await post('/status', { worldId: 'never-provisioned' }, { authorization: 'Bearer nope' })).status).toBe(401)
  })

  it('requires a worldId', async () => {
    const { worldKey } = await provisionWorld()
    expect((await post('/status', {}, { authorization: `Bearer ${worldKey}` })).status).toBe(400)
  })

  it('writes nothing but its rate-limit counter', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    const before = new Map(env.TOKENS.store)
    await post('/status', { worldId: worldPushId, userIds: ['alice'] }, { authorization: `Bearer ${worldKey}` })
    const changed = [...env.TOKENS.store.keys()].filter((k) => env.TOKENS.store.get(k) !== before.get(k))
    expect(changed.every((k) => k.startsWith('iprl:'))).toBe(true)
  })
})

describe('deep-link identity', () => {
  it('stamps the world id and the device’s own server base', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA', 'http://192.168.1.5:30001')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b', messageId: 'msg1' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsBodies[0]).toMatchObject({
      tmMessageId: 'msg1',
      tmWorldId: worldPushId,
      tmServerBaseUrl: 'http://192.168.1.5:30001',
    })
  })

  it('gives each device the base it registered from', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'lanPhone', 'http://192.168.1.5:30001')
    await registerDevice(worldPushId, worldKey, 'alice', 'tunnelPhone', 'https://foundry.example.com')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const bases = apnsBodies.map((b) => (b as { tmServerBaseUrl?: string }).tmServerBaseUrl).sort()
    expect(bases).toEqual(['http://192.168.1.5:30001', 'https://foundry.example.com'])
  })

  it('omits the server base for a device that never sent one', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect((apnsBodies[0] as { tmServerBaseUrl?: string }).tmServerBaseUrl).toBeUndefined()
    // The world id still rides along, so a tap can at least tell worlds apart.
    expect((apnsBodies[0] as { tmWorldId?: string }).tmWorldId).toBe(worldPushId)
  })
})

describe('coalescing + freshness headers', () => {
  it('collapses ambient chat per (world, user) but lets direct messages stack', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')

    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], direct: ['bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )

    const collapseFor = (device: string) =>
      apnsHeaders[apnsCalls.findIndex((u) => u.includes(device))]['apns-collapse-id']
    // Ambient: a later table message replaces this banner rather than stacking.
    expect(collapseFor('devA')).toBe(`${worldPushId}:alice`)
    // Direct: no collapse id, so a whisper is never buried by ambient chat.
    expect(collapseFor('devB')).toBeUndefined()
  })

  it('gives each user their own collapse id', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const ids = apnsHeaders.map((h) => h['apns-collapse-id'])
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id!.length <= 64)).toBe(true)
  })

  it('clamps an over-long collapse id to the APNs 64-byte limit', async () => {
    const worldPushId = 'w'.repeat(80)
    const worldKey = 'k'.repeat(32)
    await post('/provision', { worldPushId, worldKey }, { 'CF-Connecting-IP': '3.3.3.3' })
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsHeaders[0]['apns-collapse-id']).toHaveLength(64)
  })

  it('sets apns-expiration about an hour out so stale chat is dropped, not stored', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const expiration = Number(apnsHeaders[0]['apns-expiration'])
    const secondsOut = expiration - Math.floor(Date.now() / 1000)
    expect(secondsOut).toBeGreaterThan(3500)
    expect(secondsOut).toBeLessThanOrEqual(3600)
  })
})

describe('rate-limit classes', () => {
  // Exhaust one class's bucket for a world.
  async function exhaust(worldPushId: string, worldKey: string, direct: boolean) {
    for (let i = 0; i < 60; i++) {
      await post(
        '/notify',
        {
          worldId: worldPushId,
          recipients: ['filler'],
          ...(direct ? { direct: ['filler'] } : {}),
          title: 't',
          body: 'b',
        },
        { authorization: `Bearer ${worldKey}` },
      )
    }
  }

  it('still delivers a direct message when ambient chat has burned its budget', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    await exhaust(worldPushId, worldKey, false)

    apnsCalls = []
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], direct: ['bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { results: Array<{ userId: string; skipped?: string; ok?: boolean }> }
    // Bob was whispered to: delivered. Alice was ambient: shed, and reported as such.
    expect(apnsCalls.some((u) => u.includes('devB'))).toBe(true)
    expect(apnsCalls.some((u) => u.includes('devA'))).toBe(false)
    expect(json.results.find((r) => r.userId === 'bob')?.ok).toBe(true)
    expect(json.results.find((r) => r.userId === 'alice')?.skipped).toBe('rate limited')
  })

  it('keeps the direct bucket independent of the ambient one', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await exhaust(worldPushId, worldKey, true)

    // Direct is spent; ambient is untouched and still delivers.
    apnsCalls = []
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsCalls.some((u) => u.includes('devA'))).toBe(true)

    // A direct send in the same minute is over limit, and nothing survives → 429.
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], direct: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(429)
  })

  it('treats a payload without `direct` as all-ambient (older module, unchanged behaviour)', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await exhaust(worldPushId, worldKey, false)
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(429)
  })
})

describe('durability: bookkeeping never costs a delivery', () => {
  // Write registrations straight into KV: a device count that matters here would
  // otherwise trip /register's own per-IP limit.
  function seedRegistrations(worldPushId: string, userId: string, deviceTokens: string[]) {
    env.TOKENS.store.set(
      `tok:${worldPushId}:${userId}`,
      JSON.stringify(
        deviceTokens.map((deviceToken) => ({ deviceToken, platform: 'ios', env: 'sandbox', updatedAt: Date.now() })),
      ),
    )
  }

  it('still delivers when the badge counter cannot be written', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    // The daily KV write allowance is spent.
    kvFailWrite = (k) => k.startsWith('badge:')

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], direct: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.length).toBe(1)
    // Delivered, just without moving the icon number.
    expect(apnsBodies[0].aps?.badge).toBeUndefined()
  })

  it('still delivers when the rate-limit counter cannot be written (fails open)', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    kvFailWrite = (k) => k.startsWith('rl:')
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.length).toBe(1)
  })

  it('still delivers when the write-back of pruned registrations fails', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    // Dead token → the relay wants to prune, but cannot persist that.
    apnsResponse = () => ({ status: 410, body: '' })
    kvFailWrite = (k) => k.startsWith('tok:')
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { results: Array<{ dead?: boolean }> }
    expect(json.results[0].dead).toBe(true)
  })

  it('isolates one recipient’s failure from the rest', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    // Alice's registration list is unreadable; Bob's is fine.
    kvFailRead = (k) => k === `tok:${worldPushId}:alice`

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // Bob still got his push — the old sequential loop would have thrown first.
    expect(apnsCalls.some((u) => u.includes('devB'))).toBe(true)
    const json = (await res.json()) as { results: Array<{ userId: string; error?: string; ok?: boolean }> }
    expect(json.results.find((r) => r.userId === 'alice')?.error).toBeTruthy()
    expect(json.results.find((r) => r.userId === 'bob')?.ok).toBe(true)
  })

  it('reports 502 when every recipient failed, so the caller retries', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    kvFailRead = (k) => k.startsWith('tok:')
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    // Nothing was delivered, so a retry cannot double-notify anyone.
    expect(res.status).toBe(502)
    expect(apnsCalls.length).toBe(0)
  })

  it('survives an APNs send that rejects outright', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    const realFetch = globalThis.fetch as typeof fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('devA')) throw new Error('connection reset')
      return realFetch(input, init)
    })

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { results: Array<{ userId: string; ok?: boolean; status?: number }> }
    expect(json.results.find((r) => r.userId === 'alice')?.ok).toBe(false)
    expect(json.results.find((r) => r.userId === 'bob')?.ok).toBe(true)
  })

  it('caps sends at the subrequest budget and sheds ambient before direct', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    seedRegistrations(worldPushId, 'alice', Array.from({ length: 5 }, (_, i) => `alice-dev${i}`))
    seedRegistrations(worldPushId, 'bob', Array.from({ length: 40 }, (_, i) => `bob-dev${i}`))

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], direct: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      budgetExhausted?: boolean
      results: Array<{ userId: string; skipped?: string; ok?: boolean }>
    }
    // The ceiling is respected rather than thrown through — and it is the WHOLE
    // ceiling, KV reads and badge writes included, not just the sends.
    expect(kvOps + apnsCalls.length).toBeLessThanOrEqual(SUBREQUEST_CEILING)
    // Alice was whispered to: every one of her devices got it.
    expect(apnsCalls.filter((u) => u.includes('alice-dev')).length).toBe(5)
    // Bob's ambient devices took the remainder, and every one that didn't fit is
    // reported rather than silently dropped.
    const bobSent = apnsCalls.filter((u) => u.includes('bob-dev')).length
    expect(bobSent).toBeGreaterThan(0)
    expect(bobSent).toBeLessThan(40)
    expect(json.results.filter((r) => r.skipped === 'send budget exhausted').length).toBe(40 - bobSent)
    expect(json.budgetExhausted).toBe(true)
  })

  it('stays under the subrequest ceiling for an ordinary table, badges and all', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    const table = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']
    for (const who of table) await registerDevice(worldPushId, worldKey, who, `${who}-phone`)
    kvOps = 0

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: table, title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // Nobody is shed at this size: six phones, six sends, every badge written.
    expect(apnsCalls.length).toBe(6)
    expect(apnsBodies.every((b) => typeof b.aps?.badge === 'number')).toBe(true)
    expect(kvOps + apnsCalls.length).toBeLessThanOrEqual(SUBREQUEST_CEILING)
    expect((await res.json()) as { budgetExhausted?: boolean }).not.toHaveProperty('budgetExhausted')
  })

  it('sheds the badge before it sheds a notification', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    seedRegistrations(worldPushId, 'alice', Array.from({ length: 14 }, (_, i) => `alice-dev${i}`))

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], direct: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // Every device still hears about it...
    expect(apnsCalls.length).toBe(14)
    // ...but the later ones arrive without an icon number, which is the cheaper wrong.
    expect(apnsBodies.some((b) => typeof b.aps?.badge === 'number')).toBe(true)
    expect(apnsBodies.some((b) => b.aps?.badge === undefined)).toBe(true)
    expect(kvOps + apnsCalls.length).toBeLessThanOrEqual(SUBREQUEST_CEILING)
  })

  it('caps how many recipients one notify may name, and says how many it dropped', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    const res = await post(
      '/notify',
      {
        worldId: worldPushId,
        recipients: Array.from({ length: 250 }, (_, i) => `user${i}`),
        title: 't',
        body: 'b',
      },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ droppedRecipients: 50 })
    expect(kvOps + apnsCalls.length).toBeLessThanOrEqual(SUBREQUEST_CEILING)
  })
})

describe('write-back does not clobber a concurrent registration', () => {
  it('keeps a device that registered while the sends were in flight', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'old-phone')
    const key = `tok:${worldPushId}:alice`

    // 'old-phone' is dead, so this notify will rewrite alice's list. While the
    // send is in flight, a second device registers — exactly what the app does on
    // foreground — and the write-back must not erase it.
    let registered = false
    apnsResponse = (url) => {
      // Once — the dead-token path also retries the other environment, and a
      // device only registers itself the once.
      if (url.includes('old-phone') && !registered) {
        registered = true
        const regs = JSON.parse(env.TOKENS.store.get(key)!)
        regs.push({ deviceToken: 'new-phone', platform: 'ios', env: 'sandbox', updatedAt: Date.now() })
        env.TOKENS.store.set(key, JSON.stringify(regs))
      }
      return url.includes('old-phone') ? { status: 410, body: 'Unregistered' } : { status: 200, body: '' }
    }

    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )

    const stored = JSON.parse(env.TOKENS.store.get(key)!) as Array<{ deviceToken: string }>
    expect(stored.map((r) => r.deviceToken)).toEqual(['new-phone'])
  })
})

describe('APNs provider token', () => {
  it('refreshes an expired JWT and retries instead of blacking out the isolate', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')

    let first = true
    apnsResponse = () => {
      if (first) {
        first = false
        return { status: 403, body: '{"reason":"ExpiredProviderToken"}' }
      }
      return { status: 200, body: '' }
    }

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ ok?: boolean }> }
    expect(json.results[0].ok).toBe(true)
    // The retry carries a freshly signed token, not the rejected one.
    expect(apnsCalls.length).toBeGreaterThanOrEqual(2)
    expect(apnsHeaders[1].authorization).not.toBe(apnsHeaders[0].authorization)
  })
})

describe('one device, two identities in the same world', () => {
  it('notifies a shared device once, not once per user', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    // The same phone, registered as a player and as the app-user they own —
    // both addressed by one whisper.
    await registerDevice(worldPushId, worldKey, 'alice', 'shared-phone')
    await registerDevice(worldPushId, worldKey, 'alice-app', 'shared-phone')

    const res = await post(
      '/notify',
      {
        worldId: worldPushId,
        recipients: ['alice', 'alice-app'],
        direct: ['alice', 'alice-app'],
        title: 't',
        body: 'b',
      },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.filter((u) => u.includes('shared-phone')).length).toBe(1)
    const json = (await res.json()) as { results: Array<{ skipped?: string }> }
    expect(json.results.filter((r) => r.skipped === 'device already notified').length).toBe(1)
    // One banner, so one badge increment — not two racing each other to the same key.
    expect(env.TOKENS.store.get('badge:dev:shared-phone')).toBe('1')
  })
})

describe('badge count', () => {
  async function notify(worldPushId: string, worldKey: string) {
    return post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
  }

  it('increments aps.badge per notify and resets on re-register', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')

    await notify(worldPushId, worldKey)
    await notify(worldPushId, worldKey)
    expect(apnsBodies.map((b) => b.aps?.badge)).toEqual([1, 2])

    // Re-registering (coming back online) resets the count.
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    apnsBodies = []
    await notify(worldPushId, worldKey)
    expect(apnsBodies[0].aps?.badge).toBe(1)
  })

  it('counts per device across worlds, so two worlds accumulate one running total', async () => {
    const a = await provisionWorld('1.1.1.1')
    const b = await provisionWorld('2.2.2.2')
    await registerDevice(a.worldPushId, a.worldKey, 'alice', 'phone')
    await registerDevice(b.worldPushId, b.worldKey, 'alice', 'phone')

    apnsBodies = []
    await notify(a.worldPushId, a.worldKey)
    await notify(b.worldPushId, b.worldKey)
    await notify(a.worldPushId, a.worldKey)
    // Not [1, 1, 2] — the badge is the number on one icon, not per world.
    expect(apnsBodies.map((x) => x.aps?.badge)).toEqual([1, 2, 3])
  })

  it('counts each of a user’s devices separately', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'phone')
    await notify(worldPushId, worldKey)

    // A second device joins late: its icon starts at 1, the phone keeps counting.
    await registerDevice(worldPushId, worldKey, 'alice', 'tablet')
    apnsBodies = []
    apnsCalls = []
    await notify(worldPushId, worldKey)
    const byDevice = new Map(apnsCalls.map((u, i) => [u.includes('tablet') ? 'tablet' : 'phone', apnsBodies[i].aps?.badge]))
    expect(byDevice.get('phone')).toBe(2)
    expect(byDevice.get('tablet')).toBe(1)
  })
})

describe('rate limiting', () => {
  it('caps /provision per IP (20/min)', async () => {
    const ip = '9.9.9.9'
    const codes: number[] = []
    for (let i = 0; i < 22; i++) {
      const res = await post('/provision', { worldPushId: `w${i}`, worldKey: `k${i}` }, { 'CF-Connecting-IP': ip })
      codes.push(res.status)
    }
    expect(codes.filter((c) => c === 200).length).toBe(20)
    expect(codes.filter((c) => c === 429).length).toBe(2)
  })

  it('caps ambient /notify per world (60/min)', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    let limited = 0
    for (let i = 0; i < 62; i++) {
      const res = await post(
        '/notify',
        { worldId: worldPushId, recipients: [], title: 't', body: 'b' },
        { authorization: `Bearer ${worldKey}` },
      )
      if (res.status === 429) limited++
    }
    expect(limited).toBe(2)
  })
})

describe('/send admin endpoint', () => {
  it('requires the admin bearer', async () => {
    expect((await post('/send', { deviceToken: 'd', title: 't', body: 'b' })).status).toBe(401)
  })

  it('sends with the admin bearer', async () => {
    const res = await post('/send', { deviceToken: 'd', title: 't', body: 'b' }, { authorization: 'Bearer test-secret' })
    expect(res.status).toBe(200)
  })
})
