// tablemate-push-relay
//
// A stateless Cloudflare Worker that relays push notifications to Apple Push
// Notification service (APNs). It signs a short-lived ES256 JWT with the APNs
// .p8 auth key and POSTs alerts to APNs over HTTP/2.
//
// Endpoints:
//   POST /send      test push to an explicit device token (milestone 1)
//   POST /register  store a device token for a (worldId, userId) (milestone 2)
//   POST /notify    push to everyone registered under (worldId, userId) (m2)
//
// FCM/Android and Web Push are later milestones; /notify currently sends APNs
// only and skips non-ios registrations.

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface Env {
  APNS_KEY: string // full .p8 contents (PEM, incl. BEGIN/END lines)
  APNS_KEY_ID: string // 10-char Key ID of the .p8
  APNS_TEAM_ID: string // 10-char Apple Team ID
  APNS_BUNDLE_ID: string // e.g. io.github.thisgavagai.tablemate
  APNS_ENV: string // default 'sandbox' | 'production' when a request omits env
  RELAY_TEST_SECRET: string // admin bearer for /send and direct /register
  WORLD_PUSH_KEY: string // shared secret: signs reg tokens, authorises /notify
  TOKENS: KVNamespace // device-token store
}

interface Registration {
  deviceToken: string
  platform: 'ios' | 'android'
  env: 'sandbox' | 'production'
  updatedAt: number
}

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
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )

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
): Promise<ApnsResult> {
  const apnsEnv = envOverride ?? env.APNS_ENV
  const host = apnsEnv === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  const jwt = await getApnsJwt(env)

  const res = await fetch(`${host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } }),
  })

  return { status: res.status, apnsId: res.headers.get('apns-id'), body: await res.text() }
}

// ---------------------------------------------------------------------------
// Registration-token verification (HMAC-SHA256, minted by the Foundry module)
//
// Format: base64url(JSON {worldId, userId, exp}) + "." + base64url(HMAC)

async function verifyRegToken(token: string, key: string): Promise<{ worldId: string; userId: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts

  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, base64UrlToBytes(sigB64), enc.encode(payloadB64))
  if (!valid) return null

  let payload: { worldId?: string; userId?: string; exp?: number }
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)))
  } catch {
    return null
  }
  if (!payload.worldId || !payload.userId) return null
  if (typeof payload.exp === 'number' && Math.floor(Date.now() / 1000) > payload.exp) return null
  return { worldId: String(payload.worldId), userId: String(payload.userId) }
}

// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function tokenKey(worldId: string, userId: string): string {
  return `tok:${worldId}:${userId}`
}

async function readRegistrations(env: Env, worldId: string, userId: string): Promise<Registration[]> {
  const raw = await env.TOKENS.get(tokenKey(worldId, userId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// A device token is dead when APNs says it's unregistered (410) or invalid
// (400 BadDeviceToken). Environment mismatches are NOT dead — the app re-registers
// with its current env on launch, so we leave those in place.
function isDeadToken(result: ApnsResult): boolean {
  return result.status === 410 || (result.status === 400 && result.body.includes('BadDeviceToken'))
}

// ---------------------------------------------------------------------------
// Handlers

async function handleSend(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('authorization') !== `Bearer ${env.RELAY_TEST_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  const p = (await request.json().catch(() => null)) as {
    deviceToken?: string
    title?: string
    body?: string
    env?: string
  } | null
  if (!p?.deviceToken || !p.title || !p.body) {
    return json({ error: 'deviceToken, title and body are required' }, 400)
  }
  const result = await sendApns(env, p.deviceToken, p.title, p.body, p.env)
  return json({ ok: result.status === 200, apns: result }, result.status === 200 ? 200 : 502)
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const p = (await request.json().catch(() => null)) as {
    regToken?: string
    worldId?: string
    userId?: string
    deviceToken?: string
    platform?: Registration['platform']
    env?: Registration['env']
  } | null
  if (!p) return json({ error: 'invalid json' }, 400)

  // Identity comes from a module-minted reg token (preferred) or, for testing,
  // the admin bearer with worldId/userId supplied directly in the body.
  let worldId: string
  let userId: string
  const admin = request.headers.get('authorization') === `Bearer ${env.RELAY_TEST_SECRET}`
  if (p.regToken && env.WORLD_PUSH_KEY) {
    const verified = await verifyRegToken(p.regToken, env.WORLD_PUSH_KEY)
    if (!verified) return json({ error: 'invalid regToken' }, 401)
    worldId = verified.worldId
    userId = verified.userId
  } else if (admin) {
    if (!p.worldId || !p.userId) return json({ error: 'worldId and userId required with admin bearer' }, 400)
    worldId = p.worldId
    userId = p.userId
  } else {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!p.deviceToken || !p.platform || !p.env) {
    return json({ error: 'deviceToken, platform and env are required' }, 400)
  }

  // Upsert by device token so re-registration refreshes env/platform in place.
  const regs = (await readRegistrations(env, worldId, userId)).filter((r) => r.deviceToken !== p.deviceToken)
  regs.push({ deviceToken: p.deviceToken, platform: p.platform, env: p.env, updatedAt: Date.now() })
  await env.TOKENS.put(tokenKey(worldId, userId), JSON.stringify(regs))
  return json({ ok: true, worldId, userId, registrations: regs.length })
}

async function handleNotify(request: Request, env: Env): Promise<Response> {
  if (!env.WORLD_PUSH_KEY || request.headers.get('authorization') !== `Bearer ${env.WORLD_PUSH_KEY}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  const p = (await request.json().catch(() => null)) as {
    worldId?: string
    recipients?: string[]
    title?: string
    body?: string
  } | null
  if (!p?.worldId || !Array.isArray(p.recipients) || !p.title || !p.body) {
    return json({ error: 'worldId, recipients[], title and body are required' }, 400)
  }

  const results: Array<Record<string, unknown>> = []
  for (const userId of p.recipients) {
    const regs = await readRegistrations(env, p.worldId, userId)
    const survivors: Registration[] = []
    for (const reg of regs) {
      if (reg.platform !== 'ios') {
        results.push({ userId, platform: reg.platform, skipped: 'non-ios not wired yet' })
        survivors.push(reg)
        continue
      }
      const r = await sendApns(env, reg.deviceToken, p.title, p.body, reg.env)
      const dead = isDeadToken(r)
      results.push({ userId, status: r.status, ok: r.status === 200, dead })
      if (!dead) survivors.push(reg)
    }
    if (survivors.length !== regs.length) {
      await env.TOKENS.put(tokenKey(p.worldId, userId), JSON.stringify(survivors))
    }
  }
  return json({ ok: true, results })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('tablemate-push-relay ok', { status: 200 })
    }
    if (request.method !== 'POST') return json({ error: 'not found' }, 404)

    try {
      switch (url.pathname) {
        case '/send':
          return await handleSend(request, env)
        case '/register':
          return await handleRegister(request, env)
        case '/notify':
          return await handleNotify(request, env)
        default:
          return json({ error: 'not found' }, 404)
      }
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  },
}
