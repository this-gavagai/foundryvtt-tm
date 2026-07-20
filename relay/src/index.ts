// tablemate-push-relay — Milestone 1
//
// A stateless Cloudflare Worker that sends a single push notification through
// Apple Push Notification service (APNs). It signs a short-lived ES256 JWT with
// the APNs .p8 auth key and POSTs the alert to APNs over HTTP/2.
//
// Milestone 1 has one endpoint, POST /send, which takes an explicit device
// token in the body so you can curl a test push. Token storage (KV), the
// /register + /notify endpoints, and FCM/Web Push arrive in later milestones.

export interface Env {
  APNS_KEY: string // full .p8 contents (PEM, incl. BEGIN/END lines)
  APNS_KEY_ID: string // 10-char Key ID of the .p8
  APNS_TEAM_ID: string // 10-char Apple Team ID
  APNS_BUNDLE_ID: string // e.g. io.github.thisgavagai.tablemate
  APNS_ENV: string // 'sandbox' (Xcode dev builds) | 'production' (TestFlight/App Store)
  RELAY_TEST_SECRET: string // shared bearer token guarding /send
}

function base64UrlFromString(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlFromBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Accepts a PEM with real newlines OR with literal "\n" escapes (handy when the
// key is pasted into a single-line env var).
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

// Cache the imported key and JWT across requests within an isolate. APNs accepts
// a JWT for up to 1 hour; we refresh well before that.
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('tablemate-push-relay ok', { status: 200 })
    }

    if (request.method !== 'POST' || url.pathname !== '/send') {
      return json({ error: 'not found' }, 404)
    }

    if (request.headers.get('authorization') !== `Bearer ${env.RELAY_TEST_SECRET}`) {
      return json({ error: 'unauthorized' }, 401)
    }

    let payload: { deviceToken?: string; title?: string; body?: string; env?: string }
    try {
      payload = await request.json()
    } catch {
      return json({ error: 'invalid json' }, 400)
    }

    const { deviceToken, title, body, env: envOverride } = payload
    if (!deviceToken || !title || !body) {
      return json({ error: 'deviceToken, title and body are required' }, 400)
    }

    try {
      const result = await sendApns(env, deviceToken, title, body, envOverride)
      // APNs returns 200 on success; anything else carries a reason in the body.
      return json({ ok: result.status === 200, apns: result }, result.status === 200 ? 200 : 502)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  },
}
