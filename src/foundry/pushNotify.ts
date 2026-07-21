// Milestone 3: turn an incoming Foundry chat message into a push.
//
// Called from the createChatMessage hook, which fires in EVERY connected
// browser — so we leader-elect on the primary GM (game.users.activeGM) to post
// exactly once. Recipients are everyone who can see the message (whisper targets
// if whispered, otherwise all users), minus the author. The relay only pushes to
// users that actually have a registered device, so sending the full candidate
// list is fine. Per the product decision, notifications carry sender + body.

import { readPushConfig } from './pushRegistration'
import { logger } from '@/utils/utilities'

// Structural view of the bits of ChatMessage we read; Foundry's types are loose
// here and vary by version, so we access defensively.
interface ChatMessageLike {
  alias?: string
  content?: string
  whisper?: Array<string | { id?: string }>
  author?: { id?: string; _id?: string; name?: string }
  user?: { id?: string; name?: string }
}

function authorId(msg: ChatMessageLike): string | undefined {
  return msg.author?.id ?? msg.author?._id ?? msg.user?.id
}

function whisperIds(msg: ChatMessageLike): string[] {
  if (!Array.isArray(msg.whisper)) return []
  return msg.whisper.map((w) => (typeof w === 'string' ? w : w?.id)).filter((id): id is string => !!id)
}

function allUserIds(): string[] {
  const users = game.users as unknown as { contents?: Array<{ id?: string }> } | undefined
  return users?.contents?.map((u) => u.id).filter((id): id is string => !!id) ?? []
}

// Everyone who can see the message, minus the author. Whispered → its targets;
// public → all users.
function recipientsFor(msg: ChatMessageLike): string[] {
  const whisper = whisperIds(msg)
  const candidates = whisper.length ? whisper : allUserIds()
  const author = authorId(msg)
  return [...new Set(candidates)].filter((id) => id && id !== author)
}

function senderName(msg: ChatMessageLike): string {
  return msg.alias || msg.author?.name || msg.user?.name || 'Tabula Mensa'
}

// HTML content → a short plain-text line for the notification body.
function bodyText(html: string | undefined): string {
  const text = new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? ''
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return 'sent a message'
  return trimmed.length > 180 ? `${trimmed.slice(0, 179)}…` : trimmed
}

// Body respects the per-world opt-in: when message text is off (default), the
// content is never even read/sent — recipients get a sender-only notification.
function notificationBody(msg: ChatMessageLike, includeBody: boolean): string {
  return includeBody ? bodyText(msg.content) : 'sent a message'
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
    const recipients = recipientsFor(msg)
    if (!recipients.length) return

    const res = await fetch(`${config.relayUrl}/notify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.worldKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        worldId: config.worldId,
        recipients,
        title: senderName(msg),
        body: notificationBody(msg, config.includeBody)
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
