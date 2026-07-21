// Milestone 3: turn an incoming Foundry chat message into a push.
//
// Called from the createChatMessage hook, which fires in EVERY connected
// browser — so we leader-elect on the primary GM (game.users.activeGM) to post
// exactly once. Recipients are everyone who can see the message (whisper targets
// if whispered, otherwise all users), minus the author and anyone currently
// connected (they're already looking at the game). Unattributable/empty system
// messages are skipped. The relay only pushes to users with a registered device.

import { readPushConfig } from './pushRegistration'
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
  rolls?: unknown[]
}

function messageId(msg: ChatMessageLike): string | undefined {
  return msg.id ?? msg._id
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

function allUserIds(): string[] {
  const users = game.users as unknown as { contents?: Array<{ id?: string }> } | undefined
  return users?.contents?.map((u) => u.id).filter((id): id is string => !!id) ?? []
}

// Everyone who can see the message, minus the author and anyone currently
// connected. Whispered → its targets; public → all users.
function recipientsFor(msg: ChatMessageLike): string[] {
  const whisper = whisperIds(msg)
  const candidates = whisper.length ? whisper : allUserIds()
  const author = authorId(msg)
  return [...new Set(candidates)].filter((id) => id && id !== author && !isActiveUser(id))
}

function senderName(msg: ChatMessageLike): string {
  return msg.alias || msg.author?.name || msg.user?.name || 'Tabula Mensa'
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
function notificationBody(msg: ChatMessageLike, includeBody: boolean): string {
  return includeBody ? bodyText(msg.content) : 'sent a message'
}

// Skip noise: unattributable messages (no author — system/automation output, and
// we couldn't name a sender anyway) and empty messages carrying neither text nor
// a roll.
function isNotifiableMessage(msg: ChatMessageLike): boolean {
  if (!authorId(msg)) return false
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
    const recipients = recipientsFor(msg)
    if (!recipients.length) return

    const res = await fetch(`${config.relayUrl}/notify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.worldKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        worldId: config.worldId,
        recipients,
        title: notificationTitle(msg),
        body: notificationBody(msg, config.includeBody),
        messageId: messageId(msg)
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
