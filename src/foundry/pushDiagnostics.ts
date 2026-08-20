// Is push actually working? Everything in this feature fails quietly by design —
// a failed /provision, a relay that has moved, a world where nobody ever opened
// the app — and the result is identical in every case: no notifications, no
// error, nothing to look at. These checks give the GM something to look at.
//
// Read-only apart from the explicit test push, and safe to run repeatedly.

import {
  PUSH_ENABLED_SETTING,
  readPushConfig,
  relayUrl,
  ensureWorldPushIdentity
} from './pushRegistration'
import { lastPushDeliveryIssue } from './pushNotify'
import { MODULE_ID } from '@/api/protocol'
import { logger } from '@/utils/utilities'

declare const game: {
  settings: { get: (scope: string, key: string) => unknown }
  user?: { id?: string; name?: string; isGM?: boolean }
  users?: { contents?: Array<{ id?: string; name?: string }> }
  world?: { title?: string; id?: string }
}

// A single diagnostic line: what was checked, how it went, and the detail that
// makes it actionable.
export interface PushCheck {
  label: string
  state: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface PushDeviceCount {
  userId: string
  name: string
  count: number
}

export interface PushStatus {
  checks: PushCheck[]
  devices: PushDeviceCount[]
  // Whether a test push has anywhere to land.
  canTest: boolean
  relayUrl: string
}

const PROBE_TIMEOUT_MS = 8_000

// The relay reads one KV entry per user asked about. That is a Cloudflare-service
// operation, which answers to its own per-invocation ceiling (1,000) rather than
// to the 50 external subrequests a Worker may make — so the chunk can be far
// larger than it once was, and any real world now fits in a single call. Kept at
// the relay's own per-call cap (MAX_STATUS_USERS); anything bigger still chunks,
// each piece its own invocation with its own allowance.
const STATUS_CHUNK = 200

// Fetch with a deadline: an unreachable relay should report as unreachable in a
// few seconds, not hang the dialog until the browser gives up.
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function worldUserNames(): Map<string, string> {
  const map = new Map<string, string>()
  for (const u of game.users?.contents ?? []) if (u.id) map.set(u.id, u.name ?? u.id)
  return map
}

export async function collectPushStatus(): Promise<PushStatus> {
  const checks: PushCheck[] = []
  const url = relayUrl()
  const enabled = game.settings.get(MODULE_ID, PUSH_ENABLED_SETTING) === true

  checks.push(
    enabled
      ? { label: 'Push notifications', state: 'ok', detail: 'Enabled for this world' }
      : {
          label: 'Push notifications',
          state: 'warn',
          detail: 'Disabled — nothing is sent. Turn on "Enable push notifications" below.'
        }
  )
  if (!enabled) return { checks, devices: [], canTest: false, relayUrl: url }

  // Provisioning is a GM-only, idempotent step; running it here means opening this
  // dialog also repairs a world whose first attempt failed (offline at load), or
  // whose key the relay no longer agrees with. Forced, because the automatic path
  // is reserved to the primary GM and this is an explicit request from whichever
  // GM opened the panel.
  await ensureWorldPushIdentity({ force: true })

  const config = readPushConfig()
  if (!config) {
    checks.push({
      label: 'World identity',
      state: 'fail',
      detail: 'This world has no push identity yet. A GM must load the world once with push enabled.'
    })
    return { checks, devices: [], canTest: false, relayUrl: url }
  }
  checks.push({ label: 'World identity', state: 'ok', detail: `Registered as ${config.worldId.slice(0, 8)}…` })

  // Reachability first, so an unreachable relay is not misreported as an auth
  // problem — they need different fixes.
  try {
    const res = await fetchWithTimeout(`${url}/`)
    if (res.ok) {
      checks.push({ label: 'Relay reachable', state: 'ok', detail: url })
    } else {
      checks.push({ label: 'Relay reachable', state: 'fail', detail: `${url} answered ${res.status}` })
      return { checks, devices: [], canTest: false, relayUrl: url }
    }
  } catch (err) {
    checks.push({
      label: 'Relay reachable',
      state: 'fail',
      detail: `Could not reach ${url} (${err instanceof Error ? err.message : String(err)})`
    })
    return { checks, devices: [], canTest: false, relayUrl: url }
  }

  const names = worldUserNames()
  const userIds = [...names.keys()]
  let devices: PushDeviceCount[] = []
  let unsupported = 0
  try {
    const counts: Record<string, number> = {}
    for (let i = 0; i < Math.max(userIds.length, 1); i += STATUS_CHUNK) {
      const res = await fetchWithTimeout(`${url}/status`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.worldKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ worldId: config.worldId, userIds: userIds.slice(i, i + STATUS_CHUNK) })
      })
      if (res.status === 401) {
        checks.push({
          label: 'Relay accepts this world',
          state: 'fail',
          // Opening this dialog re-provisions (above), and a key conflict re-mints
          // the identity, so a 401 surviving all that is not something the GM can
          // fix by toggling the setting — it means the relay refused the world.
          detail:
            "The relay rejected this world's key, and re-provisioning did not repair it. " +
            'Check the relay URL below, then use Check again.'
        })
        return { checks, devices: [], canTest: false, relayUrl: url }
      }
      if (!res.ok) {
        checks.push({ label: 'Relay accepts this world', state: 'fail', detail: `Status check answered ${res.status}` })
        return { checks, devices: [], canTest: false, relayUrl: url }
      }
      const body = (await res.json()) as { devices?: Record<string, number>; unsupported?: number }
      Object.assign(counts, body.devices ?? {})
      unsupported += body.unsupported ?? 0
    }
    checks.push({ label: 'Relay accepts this world', state: 'ok', detail: 'Provisioned and authorised' })
    devices = Object.entries(counts)
      .map(([userId, count]) => ({ userId, name: names.get(userId) ?? userId, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    checks.push({
      label: 'Relay accepts this world',
      state: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    })
    return { checks, devices: [], canTest: false, relayUrl: url }
  }

  const total = devices.reduce((n, d) => n + d.count, 0)
  checks.push(
    total
      ? { label: 'Devices registered', state: 'ok', detail: `${total} across ${devices.length} user(s)` }
      : {
          label: 'Devices registered',
          state: 'warn',
          detail: 'None yet. A player registers automatically when they open the app while push is enabled.'
        }
  )

  // Registered but undeliverable. The relay counts a device only when it can
  // actually reach it, so Android lands here when the relay has no FCM
  // credential — it must not be counted above as a device that will hear
  // anything, but it should be said out loud, or that player looks registered
  // and silently is not.
  if (unsupported > 0) {
    checks.push({
      label: 'Unsupported devices',
      state: 'warn',
      detail: `${unsupported} Android device(s) registered, but the relay has no FCM credential configured, so they receive nothing.`
    })
  }

  // Everything above says the plumbing is sound; this says whether messages have
  // actually been getting through. A rate limit, or a table larger than one relay
  // invocation can serve, sheds recipients under a 200 — a shortfall no other
  // check here can see, because it is not a property of the setup.
  //
  // Only shown when there is something to show: silence is not evidence of
  // health, since this knows only what this browser sent since it loaded. Said
  // plainly, so the absence of the line is not read as an all-clear.
  const issue = lastPushDeliveryIssue()
  if (issue) {
    checks.push({
      label: 'Recent delivery',
      state: 'warn',
      detail:
        `At ${new Date(issue.at).toLocaleTimeString()}, ${issue.detail}. ` +
        'Counts only messages this browser sent since it loaded.'
    })
  }

  // A test push addresses the GM's own user, so it needs a device of their own.
  const mine = devices.find((d) => d.userId === game.user?.id)
  checks.push(
    mine
      ? { label: 'Your devices', state: 'ok', detail: `${mine.count} — a test notification can be sent` }
      : {
          label: 'Your devices',
          state: 'warn',
          detail: 'You have no device registered, so a test notification has nowhere to go.'
        }
  )

  return { checks, devices, canTest: !!mine, relayUrl: url }
}

// Send a notification to the GM's own devices, bypassing every recipient rule —
// no scope, no mention matching, no active-user suppression. If this arrives, the
// whole path works and anything still missing is a rule, not the plumbing.
export async function sendTestPush(): Promise<{ ok: boolean; detail: string }> {
  const config = readPushConfig()
  const userId = game.user?.id
  if (!config) return { ok: false, detail: 'Push is not enabled or this world has no identity yet.' }
  if (!userId) return { ok: false, detail: 'No current user.' }

  try {
    const res = await fetchWithTimeout(`${config.relayUrl}/notify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.worldKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        worldId: config.worldId,
        recipients: [userId],
        // Direct, so the test is never collapsed into an ambient banner or shed
        // by the ambient rate-limit bucket.
        direct: [userId],
        title: `${game.world?.title ?? 'Tabula Mensa'} · Test`,
        body: 'Push notifications are working.'
      })
    })
    const body = (await res.json().catch(() => null)) as {
      results?: Array<{ ok?: boolean; skipped?: string; error?: string }>
    } | null
    if (!res.ok) return { ok: false, detail: `Relay answered ${res.status}` }
    const results = body?.results ?? []
    if (!results.length) return { ok: false, detail: 'No device is registered for you in this world.' }
    const delivered = results.filter((r) => r.ok).length
    if (!delivered) {
      const why = results.find((r) => r.skipped || r.error)
      return { ok: false, detail: why?.skipped ?? why?.error ?? 'The relay accepted it but no device took it.' }
    }
    return { ok: true, detail: `Sent to ${delivered} device(s).` }
  } catch (err) {
    logger.warn('TABLEMATE: test push failed', err)
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
