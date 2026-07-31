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
//   POST /unregister {worldId, userId, deviceToken}     unbind a device from a user
//   POST /notify     {worldId, recipients, direct, title, body} push to a world's users
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
  // The Foundry origin this device reaches the world at (e.g. http://192.168.1.5:30001),
  // sent by the app at register time. Portrait paths are stitched onto this so the
  // image URL is reachable from THIS device (the GM's own localhost is not).
  serverBaseUrl?: string
}

// Coarse per-minute abuse backstops. KV is eventually consistent, so these are
// approximate ceilings — a determined distributed attacker can exceed them, so
// pair them with a Cloudflare edge Rate Limiting rule (see README). Legit
// provision/register happen a handful of times per client, so the per-IP caps
// are generous for normal use while stopping a single source from hammering.
//
// Direct messages (whispered to you, or naming you) get their OWN bucket, so a
// combat round's worth of ambient chat cannot exhaust the world's budget and
// leave the whisper that arrives at second 55 silently dropped. Ambient traffic
// keeps the original ceiling; the two are independent.
const AMBIENT_NOTIFY_PER_MINUTE = 60
const DIRECT_NOTIFY_PER_MINUTE = 60
const PROVISION_PER_MINUTE_PER_IP = 20
const REGISTER_PER_MINUTE_PER_IP = 30

// How long an undelivered notification stays worth delivering (apns-expiration).
const NOTIFICATION_TTL_SECONDS = 60 * 60

// The app re-registers (refreshing updatedAt) on every launch, so a registration
// untouched for this long is an abandoned device (uninstalled without an APNs
// dead-token signal, or a world the user left) and is pruned lazily on notify.
const STALE_REGISTRATION_MS = 30 * 24 * 60 * 60 * 1000

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

interface SendOptions {
  deviceToken: string
  title: string
  body: string
  envOverride?: string
  data?: Record<string, string>
  badge?: number
  // Set for ambient chat so a new banner REPLACES the previous one for the same
  // (world, user) instead of stacking. Left unset for direct messages — see
  // collapseIdFor.
  collapseId?: string
}

async function sendApns(env: Env, opts: SendOptions): Promise<ApnsResult> {
  const apnsEnv = opts.envOverride ?? env.APNS_ENV
  const host = apnsEnv === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
  const jwt = await getApnsJwt(env)
  // `aps.badge` sets the icon number (iOS applies it even when the app is closed).
  // Custom keys ride alongside `aps`; the app reads them from the notification's
  // data on tap to deep-link to the message (see src/api/pushNotifications.ts).
  const aps: Record<string, unknown> = { alert: { title: opts.title, body: opts.body }, sound: 'default' }
  if (typeof opts.badge === 'number') aps.badge = opts.badge
  // A portrait URL means the Notification Service Extension has work to do before
  // the banner shows; mutable-content wakes it. Only set when there's an image, so
  // portrait-less pushes display immediately without invoking the extension.
  if (typeof opts.data?.tmPortraitUrl === 'string') aps['mutable-content'] = 1
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    'apns-topic': env.APNS_BUNDLE_ID,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    // Chat is perishable. Without this header APNs stores an undelivered
    // notification and keeps retrying, so a phone that was off overnight lights
    // up with a burst of stale banners the moment it reconnects. Past the
    // deadline APNs drops it instead.
    'apns-expiration': String(Math.floor(Date.now() / 1000) + NOTIFICATION_TTL_SECONDS),
    'content-type': 'application/json',
  }
  if (opts.collapseId) headers['apns-collapse-id'] = opts.collapseId
  const res = await fetch(`${host}/3/device/${opts.deviceToken}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ aps, ...(opts.data ?? {}) }),
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

// Scoped to the DEVICE, not to (world, user): the badge is a single number on one
// app icon, and a device may be registered in several worlds at once. A per-world
// counter would make each world's push overwrite the other's number instead of
// counting up, and would misreport the total the user is about to see.
function badgeKey(deviceToken: string): string {
  return `badge:dev:${deviceToken}`
}

// Per-device running notification count for the app-icon badge. Incremented on
// each notify (iOS shows the absolute number), reset when the device
// re-registers — i.e. comes back online — which pairs with the app clearing the
// icon on open.
async function bumpBadge(env: Env, deviceToken: string): Promise<number> {
  const k = badgeKey(deviceToken)
  const next = (parseInt((await env.TOKENS.get(k)) || '0', 10) || 0) + 1
  await env.TOKENS.put(k, String(next), { expirationTtl: STALE_REGISTRATION_MS / 1000 })
  return next
}

// Ambient chat collapses into a single rolling banner per (world, user): ten
// table messages replace each other instead of stacking ten notifications, and
// the badge already carries the count. Direct messages return undefined — each
// whisper or mention is individually addressed and rare, so they stack, and a
// later ambient message can never bury one.
//
// APNs caps apns-collapse-id at 64 bytes. Both ids are opaque and module-minted,
// so clamp rather than trust their length.
function collapseIdFor(worldPushId: string, userId: string, direct: boolean): string | undefined {
  return direct ? undefined : `${worldPushId}:${userId}`.slice(0, 64)
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
    serverBaseUrl?: string
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
  const serverBaseUrl = typeof p.serverBaseUrl === 'string' && /^https?:\/\//i.test(p.serverBaseUrl) ? p.serverBaseUrl : undefined
  const regs = (await readRegistrations(env, worldPushId, userId)).filter((r) => r.deviceToken !== p.deviceToken)
  regs.push({ deviceToken: p.deviceToken, platform: p.platform, env: tokenEnv, updatedAt: Date.now(), serverBaseUrl })
  await env.TOKENS.put(tokenKey(worldPushId, userId), JSON.stringify(regs))
  // Coming back online resets the badge count; the app clears the icon locally.
  await env.TOKENS.delete(badgeKey(p.deviceToken))
  // worldId/userId are echoed so the app can persist what it registered as and
  // undo it later via /unregister without needing a live Foundry connection.
  return json({ ok: true, worldId: worldPushId, userId, registrations: regs.length })
}

// Drop one device from one world's user, so a server the user removed from the
// app stops pushing to them (otherwise it keeps sending until the 30-day stale
// prune). Deliberately narrow: it only ever removes registrations, and only the
// exact deviceToken named.
//
// Auth: a regToken when the caller still has a live world session, otherwise the
// (worldId, userId, deviceToken) triple itself — a random unguessable world id
// plus that device's own APNs token, both secrets held by the participating
// device. The worst a leaked triple grants is silencing the device that owns the
// token, which is what the endpoint is for. Per-IP throttled like /register.
async function handleUnregister(request: Request, env: Env): Promise<Response> {
  if (await overLimit(env, `iprl:unreg:${clientIp(request)}`, REGISTER_PER_MINUTE_PER_IP)) {
    return json({ error: 'rate limited' }, 429)
  }
  const p = (await request.json().catch(() => null)) as {
    regToken?: string
    worldId?: string
    userId?: string
    deviceToken?: string
  } | null
  if (!p?.deviceToken) return json({ error: 'deviceToken is required' }, 400)

  let worldPushId: string
  let userId: string
  if (p.regToken) {
    const claimed = parseRegTokenPayload(p.regToken)
    if (!claimed) return json({ error: 'invalid regToken' }, 401)
    const key = await worldKeyOf(env, claimed.worldId)
    if (!key) return json({ error: 'world not provisioned' }, 401)
    const verified = await verifyRegToken(p.regToken, key)
    if (!verified) return json({ error: 'invalid regToken' }, 401)
    worldPushId = verified.worldId
    userId = verified.userId
  } else if (p.worldId && p.userId) {
    worldPushId = p.worldId
    userId = p.userId
  } else {
    return json({ error: 'worldId and userId are required without a regToken' }, 400)
  }

  const stored = await readRegistrations(env, worldPushId, userId)
  const remaining = stored.filter((r) => r.deviceToken !== p.deviceToken)
  if (remaining.length !== stored.length) {
    await env.TOKENS.put(tokenKey(worldPushId, userId), JSON.stringify(remaining))
    // The device may still be registered elsewhere, but it is going quiet for
    // this world — clear its badge so a stale count can't linger on the icon.
    await env.TOKENS.delete(badgeKey(p.deviceToken))
  }
  // Idempotent: unregistering something already gone is a success with removed:0.
  return json({ ok: true, removed: stored.length - remaining.length, registrations: remaining.length })
}

// Resolve the portrait reference the module sent into a URL a specific device can
// actually reach. The module sends either a Foundry-relative path (needs this
// device's base prepended) or an already-absolute external art URL (used as-is).
// Returns undefined when there's nothing usable — no portrait, or a relative path
// with no known base for this device — so those pushes simply skip the image.
function portraitFor(portraitUrl: string | undefined, serverBaseUrl: string | undefined): string | undefined {
  if (!portraitUrl) return undefined
  if (/^https?:\/\//i.test(portraitUrl)) return portraitUrl
  if (!serverBaseUrl) return undefined
  try {
    return new URL(portraitUrl, serverBaseUrl.replace(/\/?$/, '/')).href
  } catch {
    return undefined
  }
}

async function handleNotify(request: Request, env: Env): Promise<Response> {
  const p = (await request.json().catch(() => null)) as {
    worldId?: string
    recipients?: string[]
    // Subset of `recipients` the message is personally addressed to — whispered
    // to them or naming them. Optional: a module older than this relay sends only
    // `recipients`, which then reads as all-ambient, i.e. exactly the previous
    // behaviour.
    direct?: string[]
    title?: string
    body?: string
    messageId?: string
    portraitUrl?: string
  } | null
  if (!p?.worldId || !Array.isArray(p.recipients) || !p.title || !p.body) {
    return json({ error: 'worldId, recipients[], title and body are required' }, 400)
  }
  // Custom keys the app/extension read from the notification. tmMessageId is the
  // same for every device; the portrait URL is resolved PER DEVICE below, since it
  // depends on the address each device reaches the world at (see portraitFor).
  const baseData: Record<string, string> = {}
  if (p.messageId) baseData.tmMessageId = p.messageId

  // Authorise against the world's own key.
  const worldKey = await worldKeyOf(env, p.worldId)
  if (!worldKey || request.headers.get('authorization') !== `Bearer ${worldKey}`) {
    return json({ error: 'unauthorized' }, 401)
  }

  // Split the audience by class and charge each its own bucket, so ambient chat
  // being over limit never costs a whisper its notification.
  const directSet = new Set(Array.isArray(p.direct) ? p.direct : [])
  const direct = p.recipients.filter((id) => directSet.has(id))
  const ambient = p.recipients.filter((id) => !directSet.has(id))
  // A request that delivers to nobody is charged as ambient: it still costs the
  // relay work, so it must not be a free hammer.
  const chargeAmbient = ambient.length > 0 || direct.length === 0
  const ambientLimited = chargeAmbient && (await overLimit(env, `rl:${p.worldId}`, AMBIENT_NOTIFY_PER_MINUTE))
  const directLimited = direct.length > 0 && (await overLimit(env, `rl:direct:${p.worldId}`, DIRECT_NOTIFY_PER_MINUTE))

  const results: Array<Record<string, unknown>> = []
  const targets: string[] = []
  for (const [list, limited, cls] of [
    [ambient, ambientLimited, 'ambient'],
    [direct, directLimited, 'direct'],
  ] as Array<[string[], boolean, string]>) {
    if (limited) {
      // Shedding is reported rather than silent, so a world hitting its ceiling is
      // visible in the response instead of looking like a successful send.
      for (const userId of list) results.push({ userId, class: cls, skipped: 'rate limited' })
    } else {
      targets.push(...list)
    }
  }
  // Nothing survived the limits — including an over-limit request that addressed
  // nobody — so this really is a rate-limited request.
  if (!targets.length && (ambientLimited || directLimited)) return json({ error: 'rate limited' }, 429)

  const now = Date.now()
  for (const userId of targets) {
    const stored = await readRegistrations(env, p.worldId, userId)
    // Drop abandoned registrations before sending; the difference is written back
    // via the `mutated` flag below.
    const regs = stored.filter((r) => now - (r.updatedAt ?? 0) < STALE_REGISTRATION_MS)
    const survivors: Registration[] = []
    let mutated = regs.length !== stored.length
    for (const reg of regs) {
      if (reg.platform !== 'ios') {
        results.push({ userId, platform: reg.platform, skipped: 'non-ios not wired yet' })
        survivors.push(reg)
        continue
      }
      // Resolve the portrait against THIS device's Foundry base, then send.
      const portrait = portraitFor(p.portraitUrl, reg.serverBaseUrl)
      const customData = portrait ? { ...baseData, tmPortraitUrl: portrait } : baseData
      const sendData = Object.keys(customData).length ? customData : undefined
      // Per device, so a device in several worlds sees one running total rather
      // than each world clobbering the other's number.
      const badge = await bumpBadge(env, reg.deviceToken)
      const send = {
        deviceToken: reg.deviceToken,
        title: p.title,
        body: p.body,
        data: sendData,
        badge,
        collapseId: collapseIdFor(p.worldId, userId, directSet.has(userId)),
      }
      // Try stored env; on failure retry the other and remember what delivers.
      let result = await sendApns(env, { ...send, envOverride: reg.env })
      let usedEnv = reg.env
      if (result.status !== 200) {
        const other: Registration['env'] = reg.env === 'production' ? 'sandbox' : 'production'
        const alt = await sendApns(env, { ...send, envOverride: other })
        if (alt.status === 200 || (isDeadToken(alt) && !isDeadToken(result))) {
          result = alt
          usedEnv = other
        }
      }
      const dead = isDeadToken(result)
      results.push({
        userId,
        class: directSet.has(userId) ? 'direct' : 'ambient',
        status: result.status,
        ok: result.status === 200,
        env: usedEnv,
        dead,
      })
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
  const result = await sendApns(env, {
    deviceToken: p.deviceToken,
    title: p.title,
    body: p.body,
    envOverride: p.env,
  })
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
        case '/unregister':
          return await handleUnregister(request, env)
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
