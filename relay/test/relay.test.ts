import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import worker from '../src/index'

// The Worker uses only web-standard APIs (crypto.subtle, fetch, Request/Response,
// btoa/atob), so we exercise its real fetch() handler in plain vitest with a
// Map-backed KV and a stubbed APNs — no Miniflare required. APNs is the only
// outbound call, so stubbing global fetch fully isolates these tests.

function makeKV() {
  const store = new Map<string, string>()
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      apnsCalls.push(url)
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

async function registerDevice(worldPushId: string, worldKey: string, userId: string, deviceToken: string) {
  const res = await post('/register', { regToken: mintToken(worldPushId, userId, worldKey), deviceToken, platform: 'ios' })
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

  it('caps /notify per world (60/min)', async () => {
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
