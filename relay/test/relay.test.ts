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

// The free plan's hard ceilings — and they are SEPARATE. A Worker invocation may
// make 50 external subrequests (fetch, i.e. the APNs sends) and, independently,
// 1,000 operations to Cloudflare services (the KV reads and writes). Exceeding
// either does not degrade: the runtime throws mid-request and the whole notify
// 500s, losing every recipient. So tests assert both, apart.
const EXTERNAL_CEILING = 50
const KV_OPERATION_CEILING = 1000

function expectUnderCeilings() {
  expect(apnsCalls.length).toBeLessThanOrEqual(EXTERNAL_CEILING)
  expect(kvOps).toBeLessThanOrEqual(KV_OPERATION_CEILING)
}

// Stand-in for the Workers rate-limiting binding: counts calls per key and
// refuses past `limit`, which is what env.LIMITER.limit({key}) does. Records the
// keys so a test can prove which bucket a request landed in — the buckets are
// the whole point of the split, and nothing else makes them observable.
function makeLimiter(limit: number) {
  const counts = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    limit: async ({ key }: { key: string }) => {
      keys.push(key)
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return { success: next <= limit }
    },
  }
}

// Env with the bindings attached, as the deployed Worker has them. The default
// `env` deliberately has none, so the rest of the suite goes on exercising the
// KV fallback.
function withLimiters(limits = { provision: 20, register: 30, notify: 60 }) {
  const provision = makeLimiter(limits.provision)
  const register = makeLimiter(limits.register)
  const notify = makeLimiter(limits.notify)
  Object.assign(env, {
    PROVISION_LIMITER: provision,
    REGISTER_LIMITER: register,
    NOTIFY_LIMITER: notify,
  })
  return { provision, register, notify }
}

type TestEnv = {
  APNS_KEY: string
  APNS_KEY_ID: string
  APNS_TEAM_ID: string
  APNS_BUNDLE_ID: string
  APNS_ENV: string
  RELAY_TEST_SECRET: string
  TOKENS: ReturnType<typeof makeKV>
  FCM_SERVICE_ACCOUNT?: string
  PROVISION_LIMITER?: ReturnType<typeof makeLimiter>
  REGISTER_LIMITER?: ReturnType<typeof makeLimiter>
  NOTIFY_LIMITER?: ReturnType<typeof makeLimiter>
}

let apnsKeyPem = ''
let fcmServiceAccount = ''

// A real P-256 pkcs8 PEM so the Worker's ES256 JWT signing actually succeeds on
// the /notify success path.
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const b64 = Buffer.from(pkcs8).toString('base64')
  apnsKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`

  // A service-account key is RSA (RS256), not the APNs key's P-256 — a real one
  // so the OAuth assertion the Worker signs is exercised rather than stubbed.
  const rsa = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const rsaPkcs8 = await crypto.subtle.exportKey('pkcs8', rsa.privateKey)
  const rsaB64 = Buffer.from(rsaPkcs8).toString('base64')
  fcmServiceAccount = JSON.stringify({
    type: 'service_account',
    project_id: 'tablemate-test',
    client_email: 'relay@tablemate-test.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${rsaB64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`,
  })
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
      // Not every outbound body is JSON: FCM's OAuth exchange is form-encoded,
      // and an unguarded parse here would reject the fetch and look exactly like
      // a failed token exchange. Push one entry per call either way, so an index
      // into apnsCalls indexes this too.
      if (typeof init?.body === 'string') {
        try {
          apnsBodies.push(JSON.parse(init.body))
        } catch {
          apnsBodies.push({ raw: init.body })
        }
      } else {
        apnsBodies.push({})
      }
      const { status, body } = apnsResponse(url)
      return new Response(body, { status, headers: { 'apns-id': 'test-apns-id' } })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

const b64url = (s: string) => Buffer.from(s).toString('base64url')

// /register enforces that an APNs token is hex, so tests name a device with a
// readable label and mint its token from that label's bytes. The label stays
// legible in the source; the token is shaped like the real thing. devHex() is
// the unpadded form, for assertions that match a family of seeded devices by
// prefix (`alice-dev0`, `alice-dev1`, …).
const devHex = (label: string) => Buffer.from(label).toString('hex')
const dev = (label: string) => devHex(label).padEnd(64, '0')

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
  label: string,
  serverBaseUrl?: string,
) {
  const res = await post('/register', {
    regToken: mintToken(worldPushId, userId, worldKey),
    deviceToken: dev(label),
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
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain(dev('devtokenA'))
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
    expect(stored.map((r) => r.deviceToken)).toEqual([dev('new-phone')])
  })

  it('rejects a tampered token', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    const [payload, sig] = mintToken(worldPushId, 'alice', worldKey).split('.')
    // Flip the FIRST character of the signature, not the last. A 32-byte HMAC is
    // 43 base64url characters — 258 bits for 256 — so the final character has two
    // spare bits, and a quarter of the substitutions for it decode to the very
    // same signature. Tampering there passed or failed on the luck of the draw.
    const bad = `${payload}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`
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

  it('costs no KV write when a re-registration says nothing new', async () => {
    // The app re-registers on every foreground, and almost every one of those
    // repeats the last. Writing each made the heartbeat the largest consumer of
    // an allowance of ~1,000 KV writes per DAY, account-wide — spent refreshing
    // an updatedAt whose deadline is thirty days out.
    withLimiters()
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA', 'http://192.168.1.5:30001')
    const stored = env.TOKENS.store.get(`tok:${worldPushId}:alice`)

    let writes = 0
    const put = env.TOKENS.put
    env.TOKENS.put = async (k, v) => {
      writes++
      return put(k, v)
    }
    const res = await registerDevice(worldPushId, worldKey, 'alice', 'devA', 'http://192.168.1.5:30001')

    expect(writes).toBe(0)
    // Unchanged on disk, and still reported as registered.
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toBe(stored)
    expect(await res.json()).toMatchObject({ registrations: 1 })
  })

  it('writes when anything about the registration actually differs', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA', 'http://192.168.1.5:30001')

    // The player moved to the remote address: the stored base is now wrong, and a
    // wrong base means portraits resolve to a host this phone cannot reach.
    await registerDevice(worldPushId, worldKey, 'alice', 'devA', 'https://foundry.example.com')
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain('foundry.example.com')

    // A second device is likewise a real change.
    await registerDevice(worldPushId, worldKey, 'alice', 'devB')
    const regs = JSON.parse(env.TOKENS.store.get(`tok:${worldPushId}:alice`)!) as Array<{ deviceToken: string }>
    expect(regs).toHaveLength(2)
  })

  it('writes again once the registration is old enough to be worth refreshing', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    const key = `tok:${worldPushId}:alice`
    const regs = JSON.parse(env.TOKENS.store.get(key)!)
    // Older than the refresh window, but nowhere near the 30-day staleness one.
    regs[0].updatedAt = Date.now() - 2 * 24 * 60 * 60 * 1000
    env.TOKENS.store.set(key, JSON.stringify(regs))

    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    const after = JSON.parse(env.TOKENS.store.get(key)!) as Array<{ updatedAt: number }>
    expect(Date.now() - after[0].updatedAt).toBeLessThan(1000)
  })

  it('does not spend a delete clearing a badge that is not there', async () => {
    // Reads are a hundred times more plentiful than writes on the free plan, and
    // a delete is a write. After the badge went direct-only there is usually
    // nothing to clear, so look before writing.
    const { worldPushId, worldKey } = await provisionWorld()
    let deletes = 0
    const del = env.TOKENS.delete
    env.TOKENS.delete = async (k) => {
      deletes++
      return del(k)
    }

    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    expect(deletes).toBe(0)

    // With a count actually standing, the delete happens.
    env.TOKENS.store.set(`badge:dev:${dev('devA')}`, '3')
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    expect(deletes).toBe(1)
    expect(env.TOKENS.store.get(`badge:dev:${dev('devA')}`)).toBeUndefined()
  })

  it('rejects a malformed device token', async () => {
    // The token is interpolated into the APNs request path. Something that is
    // not a token cannot be delivered to, and — because the fetch throws before
    // APNs ever answers — is never reported dead, so nothing would prune it.
    const { worldPushId, worldKey } = await provisionWorld()
    for (const deviceToken of ['not-hex-at-all', 'abc123', `${dev('devA')}/../../x`, `${dev('devA')}\n`]) {
      const res = await post('/register', {
        regToken: mintToken(worldPushId, 'alice', worldKey),
        deviceToken,
        platform: 'ios',
      })
      expect(res.status).toBe(400)
    }
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toBeUndefined()
  })

  it('rejects an unrecognised platform, which decides how the token is checked', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    const res = await post('/register', {
      regToken: mintToken(worldPushId, 'alice', worldKey),
      deviceToken: dev('devA'),
      platform: 'web',
    })
    expect(res.status).toBe(400)
  })

  it('accepts a longer hex token than today’s 32 bytes', async () => {
    // Apple documents the token length as variable and tells you not to hard-code
    // it, so the check bounds the length generously rather than pinning it.
    const { worldPushId, worldKey } = await provisionWorld()
    const res = await post('/register', {
      regToken: mintToken(worldPushId, 'alice', worldKey),
      deviceToken: 'ab'.repeat(48),
      platform: 'ios',
    })
    expect(res.status).toBe(200)
  })
})

describe('/unregister', () => {
  it('stops delivery to the named device and is idempotent', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')

    const first = await post('/unregister', { worldId: worldPushId, userId: 'alice', deviceToken: dev('devtokenA') })
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
    const second = await post('/unregister', { worldId: worldPushId, userId: 'alice', deviceToken: dev('devtokenA') })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ removed: 0 })
  })

  it('accepts a regToken instead of an explicit world/user', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    const res = await post('/unregister', {
      regToken: mintToken(worldPushId, 'alice', worldKey),
      deviceToken: dev('devtokenA'),
    })
    expect(await res.json()).toMatchObject({ removed: 1 })
  })

  it('rejects a regToken signed with the wrong key', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    const res = await post('/unregister', {
      regToken: mintToken(worldPushId, 'alice', 'wrong-key'),
      deviceToken: dev('devtokenA'),
    })
    expect(res.status).toBe(401)
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain(dev('devtokenA'))
  })

  it('leaves the same device registered in other worlds and other devices in this one', async () => {
    const a = await provisionWorld('1.1.1.1')
    const b = await provisionWorld('2.2.2.2')
    await registerDevice(a.worldPushId, a.worldKey, 'alice', 'phone')
    await registerDevice(b.worldPushId, b.worldKey, 'alice', 'phone')
    await registerDevice(a.worldPushId, a.worldKey, 'alice', 'tablet')

    // Alice removes world A from her phone only.
    await post('/unregister', { worldId: a.worldPushId, userId: 'alice', deviceToken: dev('phone') })

    apnsCalls = []
    await post(
      '/notify',
      { worldId: a.worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${a.worldKey}` },
    )
    expect(apnsCalls.some((u) => u.includes(dev('phone')))).toBe(false)
    expect(apnsCalls.some((u) => u.includes(dev('tablet')))).toBe(true)

    apnsCalls = []
    await post(
      '/notify',
      { worldId: b.worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${b.worldKey}` },
    )
    expect(apnsCalls.some((u) => u.includes(dev('phone')))).toBe(true)
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
    expect(apnsCalls.some((u) => u.includes(dev('deviceInA')))).toBe(true)
    expect(apnsCalls.some((u) => u.includes(dev('deviceInB')))).toBe(false)

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

  it('does not prune a live registration when the stored env answers transiently', async () => {
    // The regression: APNs throttles or wobbles on the CORRECT environment, the
    // relay probes the other one, and that one answers BadDeviceToken — because
    // a token never belongs to both. Reading that as "dead" deleted a perfectly
    // good registration, and the device (backgrounded, which is the whole point)
    // would not re-register for hours.
    for (const transient of [
      { status: 429, body: JSON.stringify({ reason: 'TooManyRequests' }) },
      { status: 503, body: JSON.stringify({ reason: 'ServiceUnavailable' }) },
    ]) {
      const { worldPushId, worldKey } = await provisionWorld()
      await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA') // stored env: sandbox
      apnsResponse = (url) =>
        url.includes('sandbox') ? transient : { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }

      apnsCalls = []
      const res = await post(
        '/notify',
        { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
        { authorization: `Bearer ${worldKey}` },
      )
      const json = (await res.json()) as { results: Array<{ status: number; dead: boolean; env: string }> }
      expect(json.results[0]).toMatchObject({ status: transient.status, dead: false, env: 'sandbox' })
      // A transient answer says nothing about the environment, so the other one
      // is never probed — and the registration survives untouched.
      expect(apnsCalls.length).toBe(1)
      expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain(dev('devtokenA'))
    }
  })

  it('does not prune a live registration when the stored env is unreachable', async () => {
    // Same shape, but the send never gets an answer at all (trySendApns reports
    // status 0). Nothing was learned, so nothing may be concluded.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    apnsResponse = (url) => {
      if (url.includes('sandbox')) throw new Error('connection reset')
      return { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) }
    }

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ dead: boolean }> }
    expect(json.results[0].dead).toBe(false)
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain(dev('devtokenA'))
  })

  it('prunes a token that is dead in the environment it is filed under', async () => {
    // The genuine case the env retry must still reach: sandbox is the wrong
    // environment for this token AND the token is dead in production too.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devtokenA')
    apnsResponse = () => ({ status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) })

    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsCalls.some((u) => u.includes('sandbox'))).toBe(true)
    expect(apnsCalls.some((u) => !u.includes('sandbox'))).toBe(true)
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toBe('[]')
  })

  it('skips a stored token it could never send to, without spending a subrequest on it', async () => {
    // /register rejects these now, but entries written before that check are
    // still in KV. Sending one throws inside fetch — which is not a verdict APNs
    // gave, so it never counts as dead — and would cost two subrequests out of
    // every notify until the 30-day sweep.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    const key = `tok:${worldPushId}:alice`
    const regs = JSON.parse(env.TOKENS.store.get(key)!)
    regs[0].deviceToken = 'not-a-token'
    env.TOKENS.store.set(key, JSON.stringify(regs))

    apnsCalls = []
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsCalls.length).toBe(0)
    const json = (await res.json()) as { results: Array<{ skipped?: string }> }
    expect(json.results[0].skipped).toBe('unusable device token')
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
      deviceToken: dev('devB'),
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
      { worldId: worldPushId, userIds: Array.from({ length: 250 }, (_, i) => `user${i}`) },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // One KV read per user. /status makes no external call, so its ceiling is the
    // 1,000-operation KV one rather than the 50 sends — but it is still a ceiling,
    // and the caller chunks past it.
    expect(await res.json()).toMatchObject({ truncated: true, devices: { user0: 1 } })
    expect(kvOps).toBeLessThanOrEqual(KV_OPERATION_CEILING)
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

    const collapseFor = (label: string) =>
      apnsHeaders[apnsCalls.findIndex((u) => u.includes(dev(label)))]['apns-collapse-id']
    // Ambient: a later table message replaces this banner rather than stacking.
    expect(collapseFor('devA')).toBe(`${worldPushId}:alice`)
    // Direct, and this caller named no message: nothing to collapse against, so
    // no collapse id — a whisper is never buried by ambient chat.
    expect(collapseFor('devB')).toBeUndefined()
  })

  it('collapses a direct message against itself, so a retried notify is one banner', async () => {
    // The module re-sends a /notify it got no answer to, and a thrown fetch
    // cannot tell "never arrived" from "arrived and the response was lost". A
    // whisper stacks by design, so the re-send used to be a second banner.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    const whisper = {
      worldId: worldPushId,
      recipients: ['bob'],
      direct: ['bob'],
      title: 't',
      body: 'b',
      messageId: 'chatmsg1',
    }

    await post('/notify', whisper, { authorization: `Bearer ${worldKey}` })
    await post('/notify', whisper, { authorization: `Bearer ${worldKey}` })

    expect(apnsHeaders.map((h) => h['apns-collapse-id'])).toEqual(['msg:chatmsg1', 'msg:chatmsg1'])
  })

  it('still stacks two different direct messages', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    for (const messageId of ['chatmsg1', 'chatmsg2']) {
      await post(
        '/notify',
        { worldId: worldPushId, recipients: ['bob'], direct: ['bob'], title: 't', body: 'b', messageId },
        { authorization: `Bearer ${worldKey}` },
      )
    }
    expect(new Set(apnsHeaders.map((h) => h['apns-collapse-id'])).size).toBe(2)
  })

  it('keeps the ambient collapse id per-recipient even when a message id is named', async () => {
    // Ambient chat rolls into one banner per user however many messages arrive,
    // so the message must NOT become its collapse key there.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b', messageId: 'chatmsg1' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsHeaders[0]['apns-collapse-id']).toBe(`${worldPushId}:alice`)
  })

  it('clamps a direct collapse id to the APNs 64-byte limit', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    await post(
      '/notify',
      {
        worldId: worldPushId,
        recipients: ['bob'],
        direct: ['bob'],
        title: 't',
        body: 'b',
        messageId: 'm'.repeat(200),
      },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsHeaders[0]['apns-collapse-id']).toHaveLength(64)
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

describe('rate limiting via the binding', () => {
  // The KV counter spent a write on every request it ALLOWED, so a single source
  // could burn the free plan's ~1,000 writes/day through the rate limiter alone
  // — the budget the limiter exists to protect — after which /provision and
  // /register (whose writes must not be swallowed) 500 for every tenant.

  it('writes nothing to KV to enforce a per-IP limit', async () => {
    const { register } = withLimiters()
    const { worldPushId, worldKey } = await provisionWorld()
    const before = new Map(env.TOKENS.store)

    for (let i = 0; i < 5; i++) {
      await post(
        '/register',
        { regToken: mintToken(worldPushId, `user${i}`, worldKey), deviceToken: dev(`d${i}`), platform: 'ios' },
        { 'CF-Connecting-IP': '9.9.9.9' },
      )
    }

    const changed = [...env.TOKENS.store.keys()].filter((k) => env.TOKENS.store.get(k) !== before.get(k))
    // Registrations were written; not one rate-limit counter was.
    expect(changed.every((k) => k.startsWith('tok:'))).toBe(true)
    expect(changed.some((k) => k.startsWith('iprl:'))).toBe(false)
    expect(register.keys).toHaveLength(5)
  })

  it('enforces the per-IP ceiling it is given', async () => {
    withLimiters({ provision: 3, register: 30, notify: 60 })
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await post(
        '/provision',
        { worldPushId: `world-${i}`, worldKey: 'k'.repeat(32) },
        { 'CF-Connecting-IP': '9.9.9.9' },
      )
      statuses.push(res.status)
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429])
  })

  it('keeps ambient and direct in separate buckets', async () => {
    // Same binding, distinct keys — which is what stops a combat round of
    // ambient chat shedding the whisper that arrives at second 55.
    const { notify } = withLimiters()
    const { worldPushId, worldKey } = await provisionWorld()
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], direct: ['bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(notify.keys).toEqual([`rl:ambient:${worldPushId}`, `rl:direct:${worldPushId}`])
  })

  it('gives the freed subrequests back to delivery', async () => {
    // With the KV counters gone, /notify no longer charges its budget four
    // subrequests before it has delivered anything.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    await registerDevice(worldPushId, worldKey, 'bob', 'devB')
    // Both classes present, so both buckets are consulted.
    const message = { worldId: worldPushId, recipients: ['alice', 'bob'], direct: ['bob'], title: 't', body: 'b' }

    kvOps = 0
    await post('/notify', message, { authorization: `Bearer ${worldKey}` })
    const withKvCounters = kvOps

    withLimiters()
    kvOps = 0
    await post('/notify', message, { authorization: `Bearer ${worldKey}` })
    // Two counters, a get and a put each: four KV operations no longer spent.
    expect(withKvCounters - kvOps).toBe(4)
  })

  it('fails open if the binding throws, rather than silencing the world', async () => {
    withLimiters()
    env.NOTIFY_LIMITER!.limit = async () => {
      throw new Error('rate limiter unavailable')
    }
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')

    apnsCalls = []
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.length).toBe(1)
  })

  it('falls back to the KV counter when no binding is configured', async () => {
    // A deployment from an older Wrangler loses the improvement, not the limit.
    expect(env.PROVISION_LIMITER).toBeUndefined()
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) {
      const res = await post(
        '/provision',
        { worldPushId: `world-${i}`, worldKey: 'k'.repeat(32) },
        { 'CF-Connecting-IP': '8.8.8.8' },
      )
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 429).length).toBe(2)
    expect([...env.TOKENS.store.keys()].some((k) => k.startsWith('iprl:prov:'))).toBe(true)
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
    expect(apnsCalls.some((u) => u.includes(dev('devB')))).toBe(true)
    expect(apnsCalls.some((u) => u.includes(dev('devA')))).toBe(false)
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
    expect(apnsCalls.some((u) => u.includes(dev('devA')))).toBe(true)

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
  function seedRegistrations(worldPushId: string, userId: string, labels: string[]) {
    env.TOKENS.store.set(
      `tok:${worldPushId}:${userId}`,
      JSON.stringify(
        labels.map((label) => ({ deviceToken: dev(label), platform: 'ios', env: 'sandbox', updatedAt: Date.now() })),
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
    expect(apnsCalls.some((u) => u.includes(dev('devB')))).toBe(true)
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
      if (url.includes(dev('devA'))) throw new Error('connection reset')
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

  it('caps sends at the send budget and sheds ambient before direct', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    seedRegistrations(worldPushId, 'alice', Array.from({ length: 5 }, (_, i) => `alice-dev${i}`))
    seedRegistrations(worldPushId, 'bob', Array.from({ length: 60 }, (_, i) => `bob-dev${i}`))

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
    // Both ceilings respected, rather than thrown through.
    expectUnderCeilings()
    // Alice was whispered to: every one of her devices got it.
    expect(apnsCalls.filter((u) => u.includes(devHex('alice-dev'))).length).toBe(5)
    // Bob's ambient devices took the remainder, and every one that didn't fit is
    // reported rather than silently dropped.
    const bobSent = apnsCalls.filter((u) => u.includes(devHex('bob-dev'))).length
    expect(bobSent).toBeGreaterThan(0)
    expect(bobSent).toBeLessThan(60)
    expect(json.results.filter((r) => r.skipped === 'send budget exhausted').length).toBe(60 - bobSent)
    expect(json.budgetExhausted).toBe(true)
  })

  it('serves a table several times larger than the old shared budget allowed', async () => {
    // Charging KV against the 50 meant roughly four units per device, so a dozen
    // devices exhausted the allowance and the rest were shed. Only sends are
    // external, so the real ceiling is the sends.
    const { worldPushId, worldKey } = await provisionWorld()
    seedRegistrations(worldPushId, 'alice', Array.from({ length: 40 }, (_, i) => `alice-dev${i}`))

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], direct: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.length).toBe(40)
    expect(await res.json()).not.toHaveProperty('budgetExhausted')
    expectUnderCeilings()
  })

  it('stays well under both ceilings for an ordinary table, badges and all', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    const table = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']
    for (const who of table) await registerDevice(worldPushId, worldKey, who, `${who}-phone`)
    kvOps = 0

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: table, direct: table, title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // Nobody is shed at this size: six phones, six sends, every badge written.
    expect(apnsCalls.length).toBe(6)
    expect(apnsBodies.every((b) => typeof b.aps?.badge === 'number')).toBe(true)
    expectUnderCeilings()
    expect((await res.json()) as { budgetExhausted?: boolean }).not.toHaveProperty('budgetExhausted')
  })

  it('spends no badge write on ambient chat', async () => {
    // The badge cost a KV read and write per device per push, against ~1,000
    // writes a DAY for the whole account — one chatty session on pushScope 'all'
    // spent the lot, and then a registration or a provision could not be written
    // for any tenant. Ambient chat is the volume, so ambient chat stops paying.
    withLimiters()
    const { worldPushId, worldKey } = await provisionWorld()
    seedRegistrations(worldPushId, 'alice', Array.from({ length: 14 }, (_, i) => `alice-dev${i}`))

    kvOps = 0
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    // Every device still hears about it, and not one badge key was touched.
    expect(apnsCalls.length).toBe(14)
    expect(apnsBodies.every((b) => b.aps?.badge === undefined)).toBe(true)
    expect([...env.TOKENS.store.keys()].some((k) => k.startsWith('badge:'))).toBe(false)
    // One authorisation read plus one registration read: fourteen devices, two
    // KV operations.
    expect(kvOps).toBe(2)
  })

  it('still badges a direct message to the same devices', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    seedRegistrations(worldPushId, 'alice', Array.from({ length: 14 }, (_, i) => `alice-dev${i}`))

    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], direct: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsBodies.every((b) => b.aps?.badge === 1)).toBe(true)
    expectUnderCeilings()
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
    expectUnderCeilings()
  })

  it('spends nothing on a repeated recipient', async () => {
    // A duplicate id costs a registration read out of the budget to send
    // nothing — the device is already in sentTokens — and puts two delivery runs
    // for one user in flight against each other's write-back.
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')

    apnsCalls = []
    kvOps = 0
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'alice', 'alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(apnsCalls.length).toBe(1)
    const json = (await res.json()) as { results: Array<unknown> }
    expect(json.results).toHaveLength(1)
    // One registration read, not three.
    const withoutDuplicates = kvOps
    kvOps = 0
    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(withoutDuplicates).toBe(kvOps)
  })

  it('counts unique recipients when reporting what the cap dropped', async () => {
    // 300 names, one user: nothing was dropped, and saying "100 dropped" would
    // send the GM looking for a problem that is not there.
    const { worldPushId, worldKey } = await provisionWorld()
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: Array.from({ length: 300 }, () => 'alice'), title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(await res.json()).not.toHaveProperty('droppedRecipients')
  })

  it('ignores junk entries in the recipient list', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerDevice(worldPushId, worldKey, 'alice', 'devA')
    apnsCalls = []
    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', '', null, 42], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.length).toBe(1)
    const json = (await res.json()) as { results: Array<unknown> }
    expect(json.results).toHaveLength(1)
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
      // Guarded, so the device registers itself exactly once however many times
      // the relay ends up calling APNs for this token.
      if (url.includes(dev('old-phone')) && !registered) {
        registered = true
        const regs = JSON.parse(env.TOKENS.store.get(key)!)
        regs.push({ deviceToken: dev('new-phone'), platform: 'ios', env: 'sandbox', updatedAt: Date.now() })
        env.TOKENS.store.set(key, JSON.stringify(regs))
      }
      return url.includes(dev('old-phone')) ? { status: 410, body: 'Unregistered' } : { status: 200, body: '' }
    }

    await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )

    const stored = JSON.parse(env.TOKENS.store.get(key)!) as Array<{ deviceToken: string }>
    expect(stored.map((r) => r.deviceToken)).toEqual([dev('new-phone')])
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
    expect(apnsCalls.filter((u) => u.includes(dev('shared-phone'))).length).toBe(1)
    const json = (await res.json()) as { results: Array<{ skipped?: string }> }
    expect(json.results.filter((r) => r.skipped === 'device already notified').length).toBe(1)
    // One banner, so one badge increment — not two racing each other to the same key.
    expect(env.TOKENS.store.get(`badge:dev:${dev('shared-phone')}`)).toBe('1')
  })
})

describe('badge count', () => {
  // Direct, because the badge counts only what is addressed to you — see the
  // ambient case in the durability block.
  async function notify(worldPushId: string, worldKey: string) {
    return post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], direct: ['alice'], title: 't', body: 'b' },
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
    const byDevice = new Map(apnsCalls.map((u, i) => [u.includes(dev('tablet')) ? 'tablet' : 'phone', apnsBodies[i].aps?.badge]))
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
    const res = await post(
      '/send',
      { deviceToken: dev('devA'), title: 't', body: 'b' },
      { authorization: 'Bearer test-secret' },
    )
    expect(res.status).toBe(200)
  })

  it('rejects a malformed token rather than passing it to APNs', async () => {
    // A token pasted short, or with a stray character, is worth saying so about:
    // it goes into the APNs request path, and APNs would answer with something
    // far less obvious than "you typed it wrong".
    const res = await post(
      '/send',
      { deviceToken: 'not-a-token', title: 't', body: 'b' },
      { authorization: 'Bearer test-secret' },
    )
    expect(res.status).toBe(400)
    expect(apnsCalls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Android / FCM
//
// FCM is the second provider, and everything about it that could quietly break
// iOS delivery is asserted here: that it is opt-in on the credential, that its
// OAuth exchange is paid for once rather than per device, and that only an
// unambiguous verdict prunes a registration.

const FCM_SEND_URL = 'https://fcm.googleapis.com/v1/projects/tablemate-test/messages:send'
const OAUTH_URL = 'https://oauth2.googleapis.com/token'

// FCM tokens are not hex like APNs ones — /register checks them against a
// different pattern, so they are shaped like the real thing here too.
const fcmDev = (label: string) => `${label}:${'A'.repeat(40)}`

// A DISTINCT credential per test. The Worker caches the exchanged access token
// for the isolate's life — which is the point of it, and which outlives one
// test — so a shared client_email would let one test's token satisfy the next
// and make "exchanged once" unobservable.
let fcmCredentialSeq = 0
function withFcm() {
  fcmCredentialSeq += 1
  const sa = JSON.parse(fcmServiceAccount) as Record<string, string>
  sa.client_email = `relay-${fcmCredentialSeq}@tablemate-test.iam.gserviceaccount.com`
  env.FCM_SERVICE_ACCOUNT = JSON.stringify(sa)
}

// Answers the OAuth exchange with a usable token and lets a test decide what
// the send itself does.
function stubFcm(send: (url: string) => { status: number; body: string } = () => ({ status: 200, body: '{}' })) {
  apnsResponse = (url) =>
    url.startsWith(OAUTH_URL)
      ? { status: 200, body: JSON.stringify({ access_token: 'ya29.test-token', expires_in: 3600 }) }
      : send(url)
}

async function registerAndroid(worldPushId: string, worldKey: string, userId: string, label: string) {
  const res = await post('/register', {
    regToken: mintToken(worldPushId, userId, worldKey),
    deviceToken: fcmDev(label),
    platform: 'android',
  })
  expect(res.status).toBe(200)
}

describe('Android delivery via FCM', () => {
  it('exchanges the service account for a token, then sends to the device', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    withFcm()
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidA')
    stubFcm()
    apnsCalls = []
    apnsBodies = []

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 'Gamemaster', body: 'hello' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ ok: boolean; platform: string; status: number }> }
    expect(json.results[0]).toMatchObject({ ok: true, platform: 'android', status: 200 })

    expect(apnsCalls).toContain(OAUTH_URL)
    expect(apnsCalls).toContain(FCM_SEND_URL)
    // Authorised by the exchanged access token, not by the service-account key.
    const sendIdx = apnsCalls.indexOf(FCM_SEND_URL)
    expect(apnsHeaders[sendIdx].authorization).toBe('Bearer ya29.test-token')

    const sent = apnsBodies[sendIdx] as {
      message?: {
        token?: string
        notification?: { title?: string; body?: string }
        android?: { ttl?: string }
      }
    }
    expect(sent.message?.token).toBe(fcmDev('droidA'))
    expect(sent.message?.notification).toEqual({ title: 'Gamemaster', body: 'hello' })
    // Chat is perishable on Android too — the counterpart of apns-expiration.
    expect(sent.message?.android?.ttl).toBe('3600s')
    expectUnderCeilings()
  })

  it('pays for the OAuth exchange once, not once per device', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    withFcm()
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidA')
    await registerAndroid(worldPushId, worldKey, 'bob', 'droidB')
    stubFcm()
    apnsCalls = []

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice', 'bob'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    expect(res.status).toBe(200)
    expect(apnsCalls.filter((u) => u === OAUTH_URL)).toHaveLength(1)
    expect(apnsCalls.filter((u) => u === FCM_SEND_URL)).toHaveLength(2)
    expectUnderCeilings()
  })

  it('reports Android as unconfigured — and spends nothing — with no service account', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    // Deliberately no withFcm().
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidA')
    apnsCalls = []

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ skipped?: string }> }
    expect(json.results[0].skipped).toBe('fcm not configured')
    // No credential means no call at all — not a failed one.
    expect(apnsCalls).toHaveLength(0)
  })

  it('prunes a registration FCM reports as UNREGISTERED', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    withFcm()
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidGone')
    stubFcm(() => ({
      status: 404,
      body: JSON.stringify({
        error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
      }),
    }))

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ dead: boolean }> }
    expect(json.results[0].dead).toBe(true)
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toBe('[]')
  })

  // The asymmetry that matters: a 400 can mean the payload was wrong, so acting
  // on it would prune live devices over a bug in the sender.
  it('keeps the registration when FCM merely rejects the request', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    withFcm()
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidLive')
    stubFcm(() => ({
      status: 400,
      body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } }),
    }))

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ ok: boolean; dead: boolean }> }
    expect(json.results[0]).toMatchObject({ ok: false, dead: false })
    expect(env.TOKENS.store.get(`tok:${worldPushId}:alice`)).toContain(fcmDev('droidLive'))
  })

  // The access token is cached for the isolate, so a rejected one fails every
  // send identically until it is thrown away.
  it('re-exchanges and retries once when the access token is rejected', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    withFcm()
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidA')
    let sends = 0
    stubFcm(() => {
      sends += 1
      return sends === 1 ? { status: 401, body: 'UNAUTHENTICATED' } : { status: 200, body: '{}' }
    })

    const res = await post(
      '/notify',
      { worldId: worldPushId, recipients: ['alice'], title: 't', body: 'b' },
      { authorization: `Bearer ${worldKey}` },
    )
    const json = (await res.json()) as { results: Array<{ ok: boolean }> }
    expect(json.results[0].ok).toBe(true)
    expect(sends).toBe(2)
  })

  it('counts an Android device in /status only once FCM can reach it', async () => {
    const { worldPushId, worldKey } = await provisionWorld()
    await registerAndroid(worldPushId, worldKey, 'alice', 'droidA')
    const ask = () =>
      post('/status', { worldId: worldPushId, userIds: ['alice'] }, { authorization: `Bearer ${worldKey}` })

    // Unconfigured: registered but not deliverable, so the GM panel says so
    // rather than promising a notification that cannot come.
    let body = (await (await ask()).json()) as { devices: Record<string, number>; unsupported: number }
    expect(body.devices.alice).toBeUndefined()
    expect(body.unsupported).toBe(1)

    withFcm()
    body = (await (await ask()).json()) as { devices: Record<string, number>; unsupported: number }
    expect(body.devices.alice).toBe(1)
    expect(body.unsupported).toBe(0)
  })

  it('sends an admin /send to an Android device, and refuses when unconfigured', async () => {
    stubFcm()
    const body = { deviceToken: fcmDev('droidA'), title: 't', body: 'b', platform: 'android' }
    const auth = { authorization: 'Bearer test-secret' }

    // 501, not 400: the request is well-formed, the relay simply cannot serve it.
    expect((await post('/send', body, auth)).status).toBe(501)

    withFcm()
    const res = await post('/send', body, auth)
    expect(res.status).toBe(200)
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: true })

    // Note the patterns are not mutually exclusive — a 64-char hex APNs token
    // also satisfies the FCM one, since hex is alphanumeric. The check is a
    // shape sanity test, not a way to tell the providers apart. What it does
    // catch is a token too short to be either.
    expect((await post('/send', { ...body, deviceToken: 'too-short' }, auth)).status).toBe(400)
  })
})
