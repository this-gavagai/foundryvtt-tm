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

function makeKV() {
  const store = new Map<string, string>()
  return {
    store,
    get: async (k: string) => {
      if (kvFailRead(k)) throw new Error(`KV read failed: ${k}`)
      return store.get(k) ?? null
    },
    put: async (k: string, v: string) => {
      if (kvFailWrite(k)) throw new Error(`KV write failed: ${k}`)
      store.set(k, v)
    },
    delete: async (k: string) => void store.delete(k),
  }
}

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
    // MAX_APNS_SENDS = 30, and the ceiling is respected rather than thrown through.
    expect(apnsCalls.length).toBe(30)
    // Alice was whispered to: every one of her devices got it.
    expect(apnsCalls.filter((u) => u.includes('alice-dev')).length).toBe(5)
    // Bob's ambient devices took the remainder and the rest are reported, not silent.
    expect(apnsCalls.filter((u) => u.includes('bob-dev')).length).toBe(25)
    expect(json.results.filter((r) => r.skipped === 'send budget exhausted').length).toBe(15)
    expect(json.budgetExhausted).toBe(true)
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
