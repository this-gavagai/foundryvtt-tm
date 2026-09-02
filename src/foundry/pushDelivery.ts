// The parts of sending a push that have nothing to do with what is being sent:
// posting to the relay with retries, reading what the relay says it actually
// delivered, remembering the last shortfall for the GM's status panel, and the
// two audience facts every notification needs (who the world's users are, and
// which of them stand in for another).
//
// Extracted from pushNotify.ts when turn alerts became a second kind of
// notification (pushTurn.ts). Everything here is deliberately message-agnostic:
// the callers decide who to notify and what to say, this decides how it gets
// there and whether it did.

import { logger } from '@/utils/utilities'
import type { PushConfig } from './pushRegistration'

// Notification title budget. iOS shows roughly this many characters of a title
// before truncating (conservative for the default text size). We reserve room so
// at least the first MIN_SUBJECT_CHARS of the character name always show, and
// truncate only the game name to make it fit.
const TITLE_BUDGET = 30
const MIN_SUBJECT_CHARS = 10
const TITLE_SEPARATOR = ' · '

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value
}

export function worldName(): string {
  const world = game.world as { title?: string; id?: string } | undefined
  return world?.title || world?.id || 'Tabula Mensa'
}

// "<game> · <subject>", with the game name truncated so the subject (a speaker,
// a combatant) always keeps at least MIN_SUBJECT_CHARS characters within the
// title budget.
export function notificationTitle(subject: string): string {
  const gameMax = Math.max(1, TITLE_BUDGET - TITLE_SEPARATOR.length - MIN_SUBJECT_CHARS)
  return `${truncate(worldName(), gameMax)}${TITLE_SEPARATOR}${subject}`
}

// Art for the notification image (iOS attaches it via the Notification Service
// Extension). Foundry stores art as a path relative to the server root (e.g.
// "systems/pf2e/icons/.../seelah.webp"); we send it as-is and let the relay
// stitch it onto the address each device reaches the world at. We deliberately
// do NOT resolve it against this GM browser's origin — that's the host's own
// localhost/LAN address, which a recipient's phone cannot reach.
// Already-absolute external art (http/https) is passed through; data:/blob: art
// is dropped (a phone extension can't fetch it and it would blow the APNs size).
export function pushableArtUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined
  if (/^https?:\/\//i.test(src)) return src // absolute external art, already reachable
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return undefined // data:/blob:/other scheme
  return src // server-relative Foundry path; the relay resolves it per device
}

export interface WorldUser {
  id: string
  name?: string
  // The user this one is "owned by" (User flag tablemate.belongsTo), if any.
  belongsTo?: string
}

export function worldUsers(): WorldUser[] {
  return game.users.contents.map((u) => {
    // Read straight off `flags` rather than through getFlag. Foundry types
    // every document's flags with an index signature, so our own scope needs no
    // assertion — and the property read works on a plain deserialized user as
    // well as a live document, which getFlag does not.
    const tablemate = u.flags['tablemate'] as { belongsTo?: unknown } | undefined
    const belongsTo = tablemate?.belongsTo
    return {
      id: u.id,
      name: u.name,
      belongsTo: typeof belongsTo === 'string' ? belongsTo : undefined
    }
  })
}

// A companion-app user can be "owned by" a primary Foundry user (User flag
// tablemate.belongsTo). That app user sees the whispers aimed at its owner — see
// currentUserIds in useChatVisibility.ts — so it should be pushed for them too.
// Given the set of direct recipients, return the app users that belong to any of
// them (one level, matching the display side).
export function ownedByRecipients(recipients: Set<string>, users: WorldUser[]): string[] {
  return users.filter((u) => u.belongsTo && recipients.has(u.belongsTo)).map((u) => u.id)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

// A push is a one-shot: nothing downstream ever retries, so a request lost to a
// blipped GM wifi, a relay cold-start hiccup or a 5xx meant the notification was
// gone for good. Retry the transient cases a couple of times over a few seconds.
//
// Not retried: 2xx (done), and 4xx other than 429 — a 401 is the wrong world key
// and a 400 a bad payload, neither of which a second identical request fixes.
// 429 IS retried, though a retry inside the same minute bucket will usually be
// shed again; sustained 429 is a volume problem, not a transport one.
const NOTIFY_RETRY_DELAYS_MS = [2_000, 6_000]

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

// POST the notification, retrying transient failures. Returns the final response,
// or undefined if every attempt threw (offline for the whole window).
async function postNotify(
  relayUrl: string,
  worldKey: string,
  payload: string
): Promise<Response | undefined> {
  let lastResponse: Response | undefined
  for (let attempt = 0; ; attempt++) {
    try {
      lastResponse = await fetch(`${relayUrl}/notify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${worldKey}`, 'content-type': 'application/json' },
        body: payload
      })
      if (!isRetryableStatus(lastResponse.status)) return lastResponse
    } catch (error) {
      // Network-level failure — no response at all. Retry on the same schedule.
      lastResponse = undefined
      logger.debug('TABLEMATE: push notify attempt failed', error)
    }
    if (attempt >= NOTIFY_RETRY_DELAYS_MS.length) return lastResponse
    await delay(NOTIFY_RETRY_DELAYS_MS[attempt])
  }
}

// What the relay reports back about a delivery. Note that all of this rides a
// 200: a partly-delivered message must NOT be retried (whoever did get it would
// be notified twice), so the relay says "ok" and describes the shortfall in the
// body instead.
interface NotifyResult {
  userId?: string
  ok?: boolean
  skipped?: string
  error?: string
}

interface NotifyResponseBody {
  results?: NotifyResult[]
  budgetExhausted?: boolean
  droppedRecipients?: number
}

// Skip reasons that are bookkeeping rather than a lost notification. One phone
// registered under two of a world's users is deduped down to a single banner,
// and an Android registration on a relay with no FCM credential was never going
// to be delivered to — the status panel already reports those separately as
// unsupported.
//
// 'fcm auth unavailable' is deliberately NOT here: that relay HAS a credential
// and could not use it, which is a notification actually lost and a thing the GM
// can act on. 'non-ios not wired yet' is the pre-FCM wording, kept so a world
// pointed at an older relay deployment stays quiet rather than reporting a
// problem the GM cannot fix.
const BENIGN_SKIPS = new Set([
  'device already notified',
  'fcm not configured',
  'non-ios not wired yet'
])

// The last delivery that did not fully happen, for the GM status panel to show.
// Client-local and in-memory: it records what THIS browser sent since it loaded,
// which is the elected sender's client and so where the knowledge is. Another
// GM's panel will show nothing, which is why the panel says as much.
export interface PushDeliveryIssue {
  at: number
  detail: string
}

let lastDeliveryIssue: PushDeliveryIssue | null = null

export function lastPushDeliveryIssue(): PushDeliveryIssue | null {
  return lastDeliveryIssue
}

function recordDeliveryIssue(detail: string): void {
  lastDeliveryIssue = { at: Date.now(), detail }
  logger.warn('TABLEMATE: push notify degraded —', detail)
}

// Reduce a relay response to the one sentence a GM could act on, or null when
// everything the message asked for actually happened.
//
// The relay is scrupulous about reporting what it shed — a recipient dropped to
// a rate limit or to the subrequest budget comes back as `skipped`, with
// `budgetExhausted` on the envelope — but it reports it under a 200, so a
// caller that only checks `res.ok` throws all of it away. That is exactly the
// silence the whole feature is built to avoid: a table too big for one relay
// invocation looks identical to one where everything arrived.
function summariseDelivery(body: NotifyResponseBody | null): string | null {
  if (!body) return null
  const results = Array.isArray(body.results) ? body.results : []
  const clauses: string[] = []

  const shed = results.filter((r) => r.skipped && !BENIGN_SKIPS.has(r.skipped))
  if (shed.length) {
    const reasons = [...new Set(shed.map((r) => r.skipped as string))].sort()
    clauses.push(`${shed.length} recipient(s) not notified (${reasons.join(', ')})`)
  }
  // `ok` is only set on a result the relay actually tried to send.
  const failed = results.filter((r) => r.error !== undefined || r.ok === false)
  if (failed.length) clauses.push(`${failed.length} recipient(s) failed to deliver`)
  if (body.droppedRecipients) {
    clauses.push(`${body.droppedRecipients} recipient(s) over the relay's per-message limit`)
  }
  if (body.budgetExhausted && !shed.length)
    clauses.push("the relay's per-message work budget ran out")

  return clauses.length ? clauses.join('; ') : null
}

// What the relay's /notify takes, minus the world identity this fills in.
export interface PushPayload {
  // Everyone to notify.
  recipients: string[]
  // The subset the notification is personally addressed to. The relay gives
  // these their own rate-limit bucket and lets them stack as separate banners,
  // so ambient table chat can neither starve nor bury them.
  direct: string[]
  title: string
  body: string
  // A ChatMessage id, and ONLY that: the app deep-links a notification tap to
  // the message it names (see api/pushNotifications.ts), so a notification with
  // no message behind it must leave this unset rather than invent an id.
  messageId?: string
  portraitUrl?: string
}

// Send one notification and record whatever did not fully happen. Never throws.
export async function deliverPush(config: PushConfig, payload: PushPayload): Promise<void> {
  const res = await postNotify(
    config.relayUrl,
    config.worldKey,
    JSON.stringify({ worldId: config.worldId, ...payload })
  )
  if (!res) {
    recordDeliveryIssue('the relay could not be reached, after retries')
    return
  }
  if (!res.ok) {
    const why = await res.text().catch(() => '')
    recordDeliveryIssue(`the relay answered ${res.status}${why ? `: ${truncate(why, 200)}` : ''}`)
    return
  }
  // A 200 can still mean part of the table heard nothing — see summariseDelivery.
  const shortfall = summariseDelivery(
    (await res.json().catch(() => null)) as NotifyResponseBody | null
  )
  if (shortfall) recordDeliveryIssue(shortfall)
}
