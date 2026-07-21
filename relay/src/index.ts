// tablemate-push-relay
//
// A stateless, multi-tenant Cloudflare Worker that relays push notifications to
// APNs for the Tabula Mensa app. One relay + one APNs key serves every Foundry
// world running the tablemate module.
//
// Trust model: each world auto-generates a random opaque worldPushId + secret
// worldKey (in the module) and provisions them here (TOFU — first writer for a
// worldPushId wins). Outsiders can't guess a world's random id or read its key
// (a Foundry world setting), so they can't register or notify for it. Within a
// world the key is shared among members — the same trust boundary Foundry itself
// uses. Sends default to sender-only; bodies are a per-world GM opt-in decided
// module-side, so message text only reaches the relay when the GM turns it on.
//
// Endpoints:
//   POST /provision  {worldPushId, worldKey}            store a world's key (TOFU)
//   POST /register   {regToken, deviceToken, platform}  bind a device to a user
//   POST /notify     {worldId, recipients, title, body} push to a world's users
//   POST /send       {deviceToken, title, body, env}    admin test (RELAY_TEST_SECRET)

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface Env {
  APNS_KEY: string
  APNS_KEY_ID: string
  APNS_TEAM_ID: string
  APNS_BUNDLE_ID: string
  APNS_ENV: string
  RELAY_TEST_SECRET: string // admin bearer for /send and admin /register
  TOKENS: KVNamespace
}

interface Registration {
  deviceToken: string
  platform: 'ios' | 'android'
  env: 'sandbox' | 'production'
  updatedAt: number
}

// Coarse per-minute abuse backstops. KV is eventually consistent, so these are
// approximate ceilings — a determined distributed attacker can exceed them, so
// pair them with a Cloudflare edge Rate Limiting rule (see README). Legit
// provision/register happen a handful of times per client, so the per-IP caps
// are generous for normal use while stopping a single source from hammering.
const NOTIFY_PER_MINUTE = 60
const PROVISION_PER_MINUTE_PER_IP = 20
const REGISTER_PER_MINUTE_PER_IP = 30

// ---------------------------------------------------------------------------
// base64 / base64url helpers

function base64UrlFromString(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlFromBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------------------
// APNs JWT signing (cached per isolate)

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf.buffer
}

let cachedKey: CryptoKey | null = null
let cachedJwt: { token: string; iat: number } | null = null

async function getSigningKey(env: Env): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  cachedKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env.APNS_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  return cachedKey
}

async function getApnsJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && now - cachedJwt.iat < 3000) return cachedJwt.token
  const header = base64UrlFromString(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }))
  const payload = base64UrlFromString(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }))
  const signingInput = `${header}.${payload}`
  const key = await getSigningKey(env)
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput))
  const token = `${signingInput}.${base64UrlFromBytes(signature)}`
  cachedJwt = { token, iat: now }
  return token
}

interface ApnsResult {
  status: number
  apnsId: string | null
  body: string
}

async function sendApns(
  env: Env,
  deviceToken: string,
  title: string,
  body: string,
  envOverride?: string,
  data?: Record<string, string>,
): Promise<ApnsResult> {
  const apnsEnv = envOverride ?? env.APNS_ENV
  const host = apnsEnv === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  const jwt = await getApnsJwt(env)
  // Custom keys ride alongside `aps`; the app reads them from the notification's
  // data on tap to deep-link to the message (see src/api/pushNotifications.ts).
  const res = await fetch(`${host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...(data ?? {}) }),
  })
  return { status: res.status, apnsId: res.headers.get('apns-id'), body: await res.text() }
}

// ---------------------------------------------------------------------------
// Per-world key store + registration tokens

interface RegTokenPayload {
  worldId: string
  userId: string
  exp?: number
}

async function worldKeyOf(env: Env, worldPushId: string): Promise<string | null> {
  const raw = await env.TOKENS.get(`world:${worldPushId}`)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { key?: string }).key ?? null
  } catch {
    return null
  }
}

function parseRegTokenPayload(token: string): RegTokenPayload | null {
  const [payloadB64] = token.split('.')
  if (!payloadB64) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)))
    if (!p.worldId || !p.userId) return null
    return p
  } catch {
    return null
  }
}

// Verify base64url(payload).base64url(HMAC(payload)) against a world's key.
async function verifyRegToken(token: string, key: string): Promise<RegTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, base64UrlToBytes(sigB64), enc.encode(payloadB64))
  if (!valid) return null
  const payload = parseRegTokenPayload(token)
  if (!payload) return null
  if (typeof payload.exp === 'number' && Math.floor(Date.now() / 1000) > payload.exp) return null
  return payload
}

// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

function tokenKey(worldPushId: string, userId: string): string {
  return `tok:${worldPushId}:${userId}`
}

async function readRegistrations(env: Env, worldPushId: string, userId: string): Promise<Registration[]> {
  const raw = await env.TOKENS.get(tokenKey(worldPushId, userId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isDeadToken(result: ApnsResult): boolean {
  return result.status === 410 || (result.status === 400 && result.body.includes('BadDeviceToken'))
}

// Increment a per-minute counter under `key` and report whether it's over limit.
// Approximate (KV eventual consistency) — a coarse ceiling, not a hard guarantee.
async function overLimit(env: Env, key: string, limit: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60000)
  const k = `${key}:${bucket}`
  const current = parseInt((await env.TOKENS.get(k)) || '0', 10)
  if (current >= limit) return true
  await env.TOKENS.put(k, String(current + 1), { expirationTtl: 120 })
  return false
}

// Cloudflare sets CF-Connecting-IP to the real client IP; fall back to a
// constant so a missing header degrades to a single shared bucket, not no limit.
function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown'
}

// ---------------------------------------------------------------------------
// Handlers

async function handleProvision(request: Request, env: Env): Promise<Response> {
  // /provision is necessarily unauthenticated (TOFU), so per-IP throttle it to
  // stop a single source from creating unbounded world entries.
  if (await overLimit(env, `iprl:prov:${clientIp(request)}`, PROVISION_PER_MINUTE_PER_IP)) {
    return json({ error: 'rate limited' }, 429)
  }
  const p = (await request.json().catch(() => null)) as { worldPushId?: string; worldKey?: string } | null
  if (!p?.worldPushId || !p.worldKey) return json({ error: 'worldPushId and worldKey are required' }, 400)

  // TOFU: the first writer for a (random, unguessable) worldPushId owns it.
  // A later request with a different key is rejected, so no one can hijack a
  // world already claimed. Re-provisioning with the same key is a no-op.
  const existing = await worldKeyOf(env, p.worldPushId)
  if (existing && existing !== p.worldKey) return json({ error: 'worldPushId already provisioned' }, 409)
  if (!existing) {
    await env.TOKENS.put(`world:${p.worldPushId}`, JSON.stringify({ key: p.worldKey, createdAt: Date.now() }))
  }
  return json({ ok: true })
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  // Gated by a valid regToken, but per-IP throttle anyway so a source that has
  // (or self-mints) a world key can't hammer KV writes.
  if (await overLimit(env, `iprl:reg:${clientIp(request)}`, REGISTER_PER_MINUTE_PER_IP)) {
    return json({ error: 'rate limited' }, 429)
  }
  const p = (await request.json().catch(() => null)) as {
    regToken?: string
    worldId?: string
    userId?: string
    deviceToken?: string
    platform?: Registration['platform']
    env?: Registration['env']
  } | null
  if (!p) return json({ error: 'invalid json' }, 400)

  let worldPushId: string
  let userId: string
  const admin = request.headers.get('authorization') === `Bearer ${env.RELAY_TEST_SECRET}`
  if (p.regToken) {
    const claimed = parseRegTokenPayload(p.regToken)
    if (!claimed) return json({ error: 'invalid regToken' }, 401)
    const key = await worldKeyOf(env, claimed.worldId)
    if (!key) return json({ error: 'world not provisioned' }, 401)
    const verified = await verifyRegToken(p.regToken, key)
    if (!verified) return json({ error: 'invalid regToken' }, 401)
    worldPushId = verified.worldId
    userId = verified.userId
  } else if (admin) {
    if (!p.worldId || !p.userId) return json({ error: 'worldId and userId required with admin bearer' }, 400)
    worldPushId = p.worldId
    userId = p.userId
  } else {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!p.deviceToken || !p.platform) return json({ error: 'deviceToken and platform are required' }, 400)

  const tokenEnv: Registration['env'] =
    p.env === 'production' || p.env === 'sandbox' ? p.env : env.APNS_ENV === 'production' ? 'production' : 'sandbox'
  const regs = (await readRegistrations(env, worldPushId, userId)).filter((r) => r.deviceToken !== p.deviceToken)
  regs.push({ deviceToken: p.deviceToken, platform: p.platform, env: tokenEnv, updatedAt: Date.now() })
  await env.TOKENS.put(tokenKey(worldPushId, userId), JSON.stringify(regs))
  return json({ ok: true, worldId: worldPushId, userId, registrations: regs.length })
}

async function handleNotify(request: Request, env: Env): Promise<Response> {
  const p = (await request.json().catch(() => null)) as {
    worldId?: string
    recipients?: string[]
    title?: string
    body?: string
    messageId?: string
  } | null
  if (!p?.worldId || !Array.isArray(p.recipients) || !p.title || !p.body) {
    return json({ error: 'worldId, recipients[], title and body are required' }, 400)
  }
  const data = p.messageId ? { tmMessageId: p.messageId } : undefined

  // Authorise against the world's own key.
  const worldKey = await worldKeyOf(env, p.worldId)
  if (!worldKey || request.headers.get('authorization') !== `Bearer ${worldKey}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (await overLimit(env, `rl:${p.worldId}`, NOTIFY_PER_MINUTE)) return json({ error: 'rate limited' }, 429)

  const results: Array<Record<string, unknown>> = []
  for (const userId of p.recipients) {
    const regs = await readRegistrations(env, p.worldId, userId)
    const survivors: Registration[] = []
    let mutated = false
    for (const reg of regs) {
      if (reg.platform !== 'ios') {
        results.push({ userId, platform: reg.platform, skipped: 'non-ios not wired yet' })
        survivors.push(reg)
        continue
      }
      // Try stored env; on failure retry the other and remember what delivers.
      let result = await sendApns(env, reg.deviceToken, p.title, p.body, reg.env, data)
      let usedEnv = reg.env
      if (result.status !== 200) {
        const other: Registration['env'] = reg.env === 'production' ? 'sandbox' : 'production'
        const alt = await sendApns(env, reg.deviceToken, p.title, p.body, other, data)
        if (alt.status === 200 || (isDeadToken(alt) && !isDeadToken(result))) {
          result = alt
          usedEnv = other
        }
      }
      const dead = isDeadToken(result)
      results.push({ userId, status: result.status, ok: result.status === 200, env: usedEnv, dead })
      if (dead) {
        mutated = true
        continue
      }
      if (usedEnv !== reg.env) {
        reg.env = usedEnv
        mutated = true
      }
      survivors.push(reg)
    }
    if (mutated) await env.TOKENS.put(tokenKey(p.worldId, userId), JSON.stringify(survivors))
  }
  return json({ ok: true, results })
}

async function handleSend(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('authorization') !== `Bearer ${env.RELAY_TEST_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  const p = (await request.json().catch(() => null)) as { deviceToken?: string; title?: string; body?: string; env?: string } | null
  if (!p?.deviceToken || !p.title || !p.body) return json({ error: 'deviceToken, title and body are required' }, 400)
  const result = await sendApns(env, p.deviceToken, p.title, p.body, p.env)
  return json({ ok: result.status === 200, apns: result }, result.status === 200 ? 200 : 502)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (request.method === 'GET' && url.pathname === '/') return new Response('tablemate-push-relay ok', { status: 200 })
    if (request.method !== 'POST') return json({ error: 'not found' }, 404)

    try {
      switch (url.pathname) {
        case '/provision':
          return await handleProvision(request, env)
        case '/register':
          return await handleRegister(request, env)
        case '/notify':
          return await handleNotify(request, env)
        case '/send':
          return await handleSend(request, env)
        default:
          return json({ error: 'not found' }, 404)
      }
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  },
}
