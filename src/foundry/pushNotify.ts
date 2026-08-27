// Milestone 3: turn an incoming Foundry chat message into a push.
//
// Called from the createChatMessage hook, which fires in EVERY connected
// browser — so we leader-elect on the primary GM (game.users.activeGM) to post
// exactly once. Recipients depend on the world's push scope: whispers always
// reach their targets; public messages reach everyone ('all') or only users
// named in the text ('mentions', default). The author — along with any user they
// own — is excluded, and unattributable/empty system messages are skipped.
//
// The audience is reported to the relay in two classes (see recipientsFor).
// Messages addressed to you personally are kept clear of ambient table chat:
// they get their own rate-limit budget, stack as individual banners rather than
// collapsing, and are never suppressed for being "connected".

import { readPushConfig, isPrimaryGM, type PushScope } from './pushRegistration'
import { tablemateChatOriginUserId } from './utils/foundry'
import { logger } from '@/utils/utilities'

// Structural view of the bits of ChatMessage we read; Foundry's types are loose
// here and vary by version, so we access defensively.
interface ChatMessageLike {
  id?: string
  _id?: string
  alias?: string
  content?: string
  flavor?: string
  whisper?: Array<string | { id?: string }>
  author?: { id?: string; _id?: string; name?: string }
  user?: { id?: string; name?: string }
  speaker?: { actor?: string | null }
  rolls?: unknown[]
  flags?: {
    tablemate?: {
      audioPath?: string | null
      transcript?: string | null
      transcriptPending?: boolean | null
    }
  }
  getFlag?: (scope: string, key: string) => unknown
}

function messageId(msg: ChatMessageLike): string | undefined {
  return msg.id ?? msg._id
}

// A voice-memo message carries the uploaded clip's path in a tablemate flag
// (see foundry/handlers/chat.ts). Its content is just the <audio> element and
// an optional caption, so it needs its own notifiability + body handling.
function isVoiceMemo(msg: ChatMessageLike): boolean {
  const flagged = msg.getFlag?.('tablemate', 'audioPath')
  return !!(typeof flagged === 'string' ? flagged : msg.flags?.tablemate?.audioPath)
}

// A voice memo's AI transcript, once it lands (the sending app patches
// flags.tablemate.transcript onto the posted message once its transcription
// call returns), or '' while it's still pending / disabled / failed.
function voiceTranscript(msg: ChatMessageLike): string {
  const flagged = msg.getFlag?.('tablemate', 'transcript')
  const value = typeof flagged === 'string' ? flagged : msg.flags?.tablemate?.transcript
  // Paragraph breaks collapse to spaces: a transcript can carry them (the app's
  // optional paragraph pass adds them), but a notification banner is a couple of
  // lines of running text, not a document.
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

// Whether a transcript is actually coming for this memo. Transcription happens
// on the app that recorded the memo, using that device's own endpoint + key
// (see api/transcription.ts), so this client cannot answer the question from any
// setting of its own — the sender declares it per memo instead, and the module
// stores the declaration as a flag when the message is created.
function transcriptPending(msg: ChatMessageLike): boolean {
  const flagged = msg.getFlag?.('tablemate', 'transcriptPending')
  return !!(typeof flagged === 'boolean' ? flagged : msg.flags?.tablemate?.transcriptPending)
}

// Who this message is FROM, for the purpose of not notifying them about it.
//
// Not always the Foundry author: a roll made from the app is executed on the
// GM's client, so PF2e authors the resulting message as the GM. The listener
// already stamps the requesting user onto those messages (stampChatOrigin, read
// by chatOriginDisplay for the same reason), so prefer that stamp — without it
// the player who rolled is not recognised as the sender and gets pushed their
// own roll, while the GM is excluded from one they had no part in.
function authorId(msg: ChatMessageLike): string | undefined {
  return tablemateChatOriginUserId(msg) ?? msg.author?.id ?? msg.author?._id ?? msg.user?.id
}

// A user connected to the world right now is looking at the game, so a push
// would be redundant. Backgrounding the app drops its socket, which flips the
// user inactive and makes them eligible again — exactly when a push is wanted.
function isActiveUser(userId: string): boolean {
  return game.users.get(userId)?.active === true
}

function whisperIds(msg: ChatMessageLike): string[] {
  if (!Array.isArray(msg.whisper)) return []
  return msg.whisper.map((w) => (typeof w === 'string' ? w : w?.id)).filter((id): id is string => !!id)
}

interface WorldUser {
  id: string
  name?: string
  // The user this one is "owned by" (User flag tablemate.belongsTo), if any.
  belongsTo?: string
}

function worldUsers(): WorldUser[] {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A public message "mentions" a user when the text names their Foundry username
// prefixed with @ — "@alice". That's the same identity whispers target (/w
// [username], see useWhisperTargets.ts), and the marker has to be there: matching
// a bare username pinged anyone called "GM", "Bear" or "Will" every time the word
// came up in ordinary table talk, which is exactly the noise the default scope is
// meant to avoid. Whispers are unaffected — they address users directly.
//
// Unicode-aware boundaries so accented names still match, and the @ must not be
// mid-word so an email address can't mention someone. Names under 2 chars are
// skipped.
function isMentioned(text: string, user: WorldUser): boolean {
  const needle = user.name?.trim()
  if (!needle || needle.length < 2) return false
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}])@${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, 'iu').test(text)
  } catch {
    return text.toLowerCase().includes(`@${needle.toLowerCase()}`)
  }
}

// A companion-app user can be "owned by" a primary Foundry user (User flag
// tablemate.belongsTo). That app user sees the whispers aimed at its owner — see
// currentUserIds in useChatVisibility.ts — so it should be pushed for them too.
// Given the set of direct recipients, return the app users that belong to any of
// them (one level, matching the display side).
function ownedByRecipients(recipients: Set<string>, users: WorldUser[]): string[] {
  return users.filter((u) => u.belongsTo && recipients.has(u.belongsTo)).map((u) => u.id)
}

// Every user id that is "the same person" as the author: their login user, any
// owner they belong to, and every user owned by that owner (their siblings —
// e.g. a human's other character app-users). The ownership graph is one level
// deep on the display side, so resolving to a single root and fanning back out
// covers it. Whichever end of that pairing sent the message, none of the others
// should be pushed it — it's their own message.
function selfIds(author: string | undefined, users: WorldUser[]): Set<string> {
  if (!author) return new Set()
  const root = users.find((u) => u.id === author)?.belongsTo || author
  const self = new Set<string>([author, root])
  for (const u of users) if (u.belongsTo === root) self.add(u.id)
  return self
}

export interface PushAudience {
  // Everyone to notify — the relay's `recipients`.
  recipients: string[]
  // The subset the message is personally addressed to. The relay gives these
  // their own rate-limit bucket and lets them stack as separate banners, so
  // ambient table chat can neither starve nor bury them.
  direct: string[]
}

// Who to notify, minus the author and anything of theirs, split by class.
//
// Direct = whispered to them, or their username named in the text (whatever the
// scope). Ambient = the rest of the table, and only when the world opted into
// 'all'; a whisper has no ambient audience. In both cases users owned by a
// recipient are notified alongside them.
function recipientsFor(msg: ChatMessageLike, scope: PushScope): PushAudience {
  const author = authorId(msg)
  const users = worldUsers()
  const self = selfIds(author, users)
  const whisper = whisperIds(msg)

  const directSet = new Set<string>(whisper)
  if (!whisper.length) {
    const text = plainText(msg.content)
    if (text) for (const u of users) if (isMentioned(text, u)) directSet.add(u.id)
  }
  for (const id of ownedByRecipients(directSet, users)) directSet.add(id)

  const ambientSet = new Set<string>()
  if (!whisper.length && scope === 'all') {
    for (const u of users) if (!directSet.has(u.id)) ambientSet.add(u.id)
  }

  // Being `active` only means Foundry has not yet noticed a dropped socket —
  // detection lags a backgrounded app by tens of seconds — so suppressing on it
  // silently loses exactly the notifications sent just after someone puts their
  // phone away. For a message addressed to you personally that trade is wrong:
  // send it and accept the occasional redundant banner. Ambient chat is noise,
  // so there the suppression stays.
  const direct = [...directSet].filter((id) => id && !self.has(id))
  const ambient = [...ambientSet].filter((id) => id && !self.has(id) && !isActiveUser(id))
  return { recipients: [...direct, ...ambient], direct }
}

function senderName(msg: ChatMessageLike): string {
  return msg.alias || msg.author?.name || msg.user?.name || 'Tabula Mensa'
}

// The speaker's portrait for the notification image (iOS attaches it via the
// Notification Service Extension). Foundry stores art as a path relative to the
// server root (e.g. "systems/pf2e/icons/.../seelah.webp"); we send it as-is and
// let the relay stitch it onto the address each device reaches the world at. We
// deliberately do NOT resolve it against this GM browser's origin — that's the
// host's own localhost/LAN address, which a recipient's phone cannot reach.
// Already-absolute external art (http/https) is passed through; data:/blob: art
// is dropped (a phone extension can't fetch it and it would blow the APNs size).
// Portrait art is derived the way the app derives it (SideMenu /
// characterCore): prototype-token art first, then the actor image.
function portraitUrl(msg: ChatMessageLike): string | undefined {
  const actorId = msg.speaker?.actor
  if (!actorId) return undefined
  const actor = game.actors.get(actorId)
  const src = actor?.prototypeToken?.texture?.src ?? actor?.img
  if (!src) return undefined
  if (/^https?:\/\//i.test(src)) return src // absolute external art, already reachable
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return undefined // data:/blob:/other scheme
  return src // server-relative Foundry path; the relay resolves it per device
}

// Notification title budget. iOS shows roughly this many characters of a title
// before truncating (conservative for the default text size). We reserve room so
// at least the first MIN_SENDER_CHARS of the character name always show, and
// truncate only the game name to make it fit.
const TITLE_BUDGET = 30
const MIN_SENDER_CHARS = 10
const TITLE_SEPARATOR = ' · '

function worldName(): string {
  const world = game.world as { title?: string; id?: string } | undefined
  return world?.title || world?.id || 'Tabula Mensa'
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value
}

// "<game> · <character>", with the game name truncated so the character name
// always keeps at least MIN_SENDER_CHARS characters within the title budget.
function notificationTitle(msg: ChatMessageLike): string {
  const gameMax = Math.max(1, TITLE_BUDGET - TITLE_SEPARATOR.length - MIN_SENDER_CHARS)
  return `${truncate(worldName(), gameMax)}${TITLE_SEPARATOR}${senderName(msg)}`
}

// HTML content → collapsed plain text ('' when there's nothing to show).
function plainText(html: string | undefined): string {
  const text = new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
}

function hasRoll(msg: ChatMessageLike): boolean {
  return Array.isArray(msg.rolls) && msg.rolls.length > 0
}

// A roll can carry no prose at all — an attack, a save, a bare skill check — in
// which case there is no message text to show and "sent a message" is both true
// and useless. Fall back to the roll itself: PF2e names the check in the message
// flavor, and the total is the thing anyone reads a banner for.
function rollSummary(msg: ChatMessageLike): string {
  const totals = (Array.isArray(msg.rolls) ? msg.rolls : [])
    .map((roll) => (roll as { total?: unknown }).total)
    .filter((total): total is number => typeof total === 'number')
  if (!totals.length) return ''
  const flavor = plainText(msg.flavor)
  return flavor ? `🎲 ${truncate(flavor, 120)}: ${totals.join(', ')}` : `🎲 ${totals.join(', ')}`
}

// Body respects the per-world opt-in: when message text is off (default), the
// content is never even read/sent — recipients get a sender-only notification.
// A voice memo shows a "🎤 Voice message" indicator instead of empty text; once
// its transcript has landed (we briefly wait for it — see waitForTranscript) the
// spoken text rides alongside that indicator, and any typed caption is used as a
// fallback until then. All only when message text is opted in.
//
// "made a roll" is the sender-only wording for a roll: it says no more than the
// notification's mere existence already does, and beats telling someone their
// party's fighter "sent a message" when what happened was an attack.
function notificationBody(msg: ChatMessageLike, includeBody: boolean): string {
  if (isVoiceMemo(msg)) {
    if (!includeBody) return '🎤 Voice message'
    const text = truncate(voiceTranscript(msg) || plainText(msg.content), 180)
    return text ? `🎤 ${text}` : '🎤 Voice message'
  }
  if (!includeBody) return hasRoll(msg) ? 'made a roll' : 'sent a message'
  const text = plainText(msg.content)
  if (text) return truncate(text, 180)
  return rollSummary(msg) || 'sent a message'
}

// Skip noise: unattributable messages (no author — system/automation output, and
// we couldn't name a sender anyway) and empty messages carrying neither text nor
// a roll. A voice memo counts as content even though its text is empty.
function isNotifiableMessage(msg: ChatMessageLike): boolean {
  if (!authorId(msg)) return false
  if (isVoiceMemo(msg)) return true
  return plainText(msg.content).length > 0 || hasRoll(msg)
}

// A voice memo posts before its transcription finishes, so its push would
// otherwise always go out text-less. We hold the push for the transcript to
// appear — but only briefly: a notification that arrives 5s late is fine, one
// that never arrives is not. If the endpoint is slow/hung we send the
// sender-only "voice message" push and let the memo stay audio-only.
const TRANSCRIPT_WAIT_MS = 5_000
const TRANSCRIPT_POLL_MS = 200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

// Poll the live message document until its transcript flag lands or the wait
// budget runs out. The sending app patches the transcript onto this same
// document, which reaches this client as an updateChatMessage broadcast — so the
// flag turning up is our signal the body can now carry the spoken text.
async function waitForTranscript(msg: ChatMessageLike): Promise<void> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS
  while (!voiceTranscript(msg) && Date.now() < deadline) {
    await delay(TRANSCRIPT_POLL_MS)
  }
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
async function postNotify(relayUrl: string, worldKey: string, payload: string): Promise<Response | undefined> {
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
  if (body.budgetExhausted && !shed.length) clauses.push("the relay's per-message work budget ran out")

  return clauses.length ? clauses.join('; ') : null
}

export async function notifyChatMessage(message: unknown): Promise<void> {
  try {
    // Only the elected primary GM posts, so a message seen by N GM clients
    // produces one push, not N.
    if (!isPrimaryGM()) return

    const config = readPushConfig()
    if (!config) return

    const msg = message as ChatMessageLike
    if (!isNotifiableMessage(msg)) return
    const audience = recipientsFor(msg, config.scope)
    if (!audience.recipients.length) return

    // Give a transcribable voice memo a moment to gain its transcript so the
    // push can include the spoken text. Only worth waiting when the body is
    // opted in (otherwise it's sender-only regardless) and the sender said it is
    // transcribing (otherwise no transcript is ever coming).
    if (isVoiceMemo(msg) && config.includeBody && transcriptPending(msg)) {
      await waitForTranscript(msg)
    }

    const res = await postNotify(
      config.relayUrl,
      config.worldKey,
      JSON.stringify({
        worldId: config.worldId,
        recipients: audience.recipients,
        direct: audience.direct,
        title: notificationTitle(msg),
        body: notificationBody(msg, config.includeBody),
        messageId: messageId(msg),
        portraitUrl: portraitUrl(msg)
      })
    )
    if (!res) {
      recordDeliveryIssue('the relay could not be reached, after retries')
    } else if (!res.ok) {
      const why = await res.text().catch(() => '')
      recordDeliveryIssue(`the relay answered ${res.status}${why ? `: ${truncate(why, 200)}` : ''}`)
    } else {
      // A 200 can still mean part of the table heard nothing — see
      // summariseDelivery.
      const shortfall = summariseDelivery((await res.json().catch(() => null)) as NotifyResponseBody | null)
      if (shortfall) recordDeliveryIssue(shortfall)
    }
  } catch (error) {
    // Never let a push failure disrupt chat handling.
    logger.warn('TABLEMATE: push notify error', error)
  }
}
