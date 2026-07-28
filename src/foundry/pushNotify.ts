// Milestone 3: turn an incoming Foundry chat message into a push.
//
// Called from the createChatMessage hook, which fires in EVERY connected
// browser — so we leader-elect on the primary GM (game.users.activeGM) to post
// exactly once. Recipients depend on the world's push scope: whispers always
// reach their targets; public messages reach everyone ('all') or only users
// named in the text ('mentions', default). The author and anyone currently
// connected are excluded, and unattributable/empty system messages are skipped.

import { readPushConfig, type PushScope } from './pushRegistration'
import { logger } from '@/utils/utilities'

// Structural view of the bits of ChatMessage we read; Foundry's types are loose
// here and vary by version, so we access defensively.
interface ChatMessageLike {
  id?: string
  _id?: string
  alias?: string
  content?: string
  whisper?: Array<string | { id?: string }>
  author?: { id?: string; _id?: string; name?: string }
  user?: { id?: string; name?: string }
  speaker?: { actor?: string | null }
  rolls?: unknown[]
  flags?: { tablemate?: { audioPath?: string | null } }
  getFlag?: (scope: string, key: string) => unknown
}

// The bits of an Actor we read to find its portrait, matching how the app derives
// one (SideMenu / characterCore): prototype-token art first, then the actor image.
interface ActorLike {
  img?: string | null
  prototypeToken?: { texture?: { src?: string | null } | null } | null
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

function authorId(msg: ChatMessageLike): string | undefined {
  return msg.author?.id ?? msg.author?._id ?? msg.user?.id
}

// A user connected to the world right now is looking at the game, so a push
// would be redundant. Backgrounding the app drops its socket, which flips the
// user inactive and makes them eligible again — exactly when a push is wanted.
function isActiveUser(userId: string): boolean {
  const users = game.users as unknown as { get?: (id: string) => { active?: boolean } | undefined }
  return users.get?.(userId)?.active === true
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

type RawWorldUser = {
  id?: string
  name?: string
  flags?: { tablemate?: { belongsTo?: string } }
}

function worldUsers(): WorldUser[] {
  const users = game.users as unknown as { contents?: RawWorldUser[] } | undefined
  return (users?.contents ?? [])
    .filter((u): u is RawWorldUser & { id: string } => !!u.id)
    .map((u) => ({ id: u.id, name: u.name, belongsTo: u.flags?.tablemate?.belongsTo }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A public message "mentions" a user when their Foundry username appears as a
// whole word in the text — the same identity whispers target (/w [username], see
// useWhisperTargets.ts). Unicode-aware boundaries so accented names still match;
// names under 2 chars are skipped to avoid noise.
function isMentioned(text: string, user: WorldUser): boolean {
  const needle = user.name?.trim()
  if (!needle || needle.length < 2) return false
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, 'iu').test(text)
  } catch {
    return text.toLowerCase().includes(needle.toLowerCase())
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

// Who to notify, minus the author and anyone currently connected. Whispers always
// reach their targets. For a public message the world scope decides: 'all' →
// everyone who can see it; 'mentions' → only users named in the text. In every
// case, users owned by a recipient are notified alongside them.
function recipientsFor(msg: ChatMessageLike, scope: PushScope): string[] {
  const author = authorId(msg)
  const users = worldUsers()
  const whisper = whisperIds(msg)
  let candidates: string[]
  if (whisper.length) {
    candidates = whisper
  } else if (scope === 'all') {
    candidates = users.map((u) => u.id)
  } else {
    const text = plainText(msg.content)
    candidates = text ? users.filter((u) => isMentioned(text, u)).map((u) => u.id) : []
  }
  const recipients = new Set(candidates)
  for (const id of ownedByRecipients(recipients, users)) recipients.add(id)
  return [...recipients].filter((id) => id && id !== author && !isActiveUser(id))
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
function portraitUrl(msg: ChatMessageLike): string | undefined {
  const actorId = msg.speaker?.actor
  if (!actorId) return undefined
  const actors = game.actors as unknown as { get?: (id: string) => ActorLike | undefined } | undefined
  const actor = actors?.get?.(actorId)
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

// A short plain-text line for the notification body.
function bodyText(html: string | undefined): string {
  const text = plainText(html)
  if (!text) return 'sent a message'
  return text.length > 180 ? `${text.slice(0, 179)}…` : text
}

// Body respects the per-world opt-in: when message text is off (default), the
// content is never even read/sent — recipients get a sender-only notification.
// A voice memo shows a "🎤 Voice message" indicator instead of empty text, with
// its optional caption appended only when message text is opted in.
function notificationBody(msg: ChatMessageLike, includeBody: boolean): string {
  if (isVoiceMemo(msg)) {
    const caption = includeBody ? plainText(msg.content) : ''
    return caption ? `🎤 ${caption}` : '🎤 Voice message'
  }
  return includeBody ? bodyText(msg.content) : 'sent a message'
}

// Skip noise: unattributable messages (no author — system/automation output, and
// we couldn't name a sender anyway) and empty messages carrying neither text nor
// a roll. A voice memo counts as content even though its text is empty.
function isNotifiableMessage(msg: ChatMessageLike): boolean {
  if (!authorId(msg)) return false
  if (isVoiceMemo(msg)) return true
  return plainText(msg.content).length > 0 || (Array.isArray(msg.rolls) && msg.rolls.length > 0)
}

function isPrimaryGM(): boolean {
  const activeGmId = (game.users as unknown as { activeGM?: { id?: string } | null })?.activeGM?.id
  return !!activeGmId && game.user?.id === activeGmId
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
    const recipients = recipientsFor(msg, config.scope)
    if (!recipients.length) return

    const res = await fetch(`${config.relayUrl}/notify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.worldKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        worldId: config.worldId,
        recipients,
        title: notificationTitle(msg),
        body: notificationBody(msg, config.includeBody),
        messageId: messageId(msg),
        portraitUrl: portraitUrl(msg)
      })
    })
    if (!res.ok) {
      logger.warn('TABLEMATE: push notify failed', res.status, await res.text())
    }
  } catch (error) {
    // Never let a push failure disrupt chat handling.
    logger.warn('TABLEMATE: push notify error', error)
  }
}
