import { escapeHtml } from '@/utils/pf2eEnrich'

// Pure builders for posting a chat message DIRECTLY over Foundry's
// modifyDocument socket, instead of asking the GM proxy to run
// ChatMessage.create for us (see foundry/handlers/chat.ts for the Foundry-side
// original whose output these mirror). Kept framework-free and side-effect-free
// so the speaker/alias/content shaping is unit-testable without a socket, a
// store, or a live Foundry.

// The subset of a serialized Foundry user the builders read. Matches the shape
// the world payload hands the app (see useChatVisibility.UserData) plus `role`.
export interface ChatUserLike {
  _id?: string | null
  id?: string | null
  name?: string | null
  role?: number
  flags?: {
    tablemate?: {
      belongsTo?: string | null
    }
  }
}

// Foundry ChatMessage speaker. For an in-character message all of
// scene/token/actor/alias may be set; an out-of-character message carries only
// `alias` (the human's name), which is what makes Foundry render it as OOC.
export interface ChatSpeakerData {
  scene?: string
  token?: string
  actor?: string
  alias?: string
}

export interface ChatMessageCreateData {
  // Foundry v12+ names the field `author`; the server sets it to the emitting
  // user regardless, so this only has to agree with what the read side expects.
  author: string
  speaker: ChatSpeakerData
  content: string
  whisper?: string[]
  flags: { tablemate: { originUserId: string } }
}

// Escape + linebreak, byte-for-byte the same as foundrySendChatMessage's
// formatChatContent (foundry/handlers/chat.ts) so a message posted directly
// renders identically to one posted through the GM RPC.
export function formatChatContent(content: string): string {
  return escapeHtml(content.trim()).replace(/\n/g, '<br>')
}

// Put a voice memo's transcript into the content the module rendered for it,
// replacing any transcript already there.
//
// The transcript rides in a [data-tablemate-transcript] wrapper so Foundry's own
// chat log shows it (italic, under the player) while the app strips that wrapper
// (sanitizeChatHtml) and renders the transcript from flags.tablemate.transcript
// with its own styling — shown once on each surface, never twice.
//
// Replacing rather than appending is what lets a posted memo's transcript be
// edited: the wrapper is swapped while the caption and the <audio> element the
// Foundry-side chat log plays from are carried through untouched.
export function withTranscriptContent(content: string, transcript: string): string {
  const base = content.replace(TRANSCRIPT_WRAPPER, '')
  const text = transcript.trim()
  if (!text) return base
  // Paragraph breaks become <br>, the same way formatChatContent carries a typed
  // message's newlines — the app renders the transcript from the flag and keeps
  // the breaks as newlines, but Foundry's own log renders this HTML copy.
  const body = escapeHtml(text).replace(/\n/g, '<br>')
  return `${base}<div data-tablemate-transcript><em>${body}</em></div>`
}

// The existing wrapper, cut by pattern rather than by parsing the content into a
// DOM and re-serializing it: that round-trip rewrites the message body's markup
// (`controls` becomes `controls=""`, and so on) on every transcript edit, and
// the rest of the content is the module's to author, not ours to reformat.
//
// Safe to match this way because we are the only writer of this wrapper and its
// text is escaped, so the transcript can never contain the closing tag. The
// pattern stays tolerant of extra attributes on the div for the same reason a
// parser would be.
const TRANSCRIPT_WRAPPER = /<div[^>]*\bdata-tablemate-transcript\b[^>]*>[\s\S]*?<\/div>/g

function findUser(users: ChatUserLike[], userId: string): ChatUserLike | undefined {
  return users.find((u) => u._id === userId || u.id === userId)
}

// The name an out-of-character message speaks as: the sending user's own name,
// unless their Tablemate `belongsTo` flag points at an owning login user (a
// sheet-only user attached to a human), in which case that human's name is
// used. Mirrors outOfCharacterAlias in foundry/handlers/chat.ts.
export function outOfCharacterAlias(
  users: ChatUserLike[],
  userId: string
): string | undefined {
  const user = findUser(users, userId)
  const owner = user?.flags?.tablemate?.belongsTo
  if (typeof owner === 'string' && owner) {
    const ownerUser = findUser(users, owner)
    if (ownerUser?.name) return ownerUser.name
  }
  return user?.name ?? undefined
}

// Build the speaker Foundry would have produced via ChatMessage.getSpeaker.
// In-character: bind the actor (drives the read side's portrait) and set the
// alias to the character name (the read side reads speaker.alias for the shown
// name — falling back to the author's name only when it's absent). Scene/token
// are best-effort: they refine per-token portrait art but the read side falls
// back to the actor's own portrait when the token can't be resolved.
// Out-of-character: alias only, so Foundry treats it as an OOC message.
export function buildSpeaker(opts: {
  outOfCharacter: boolean
  actorId: string
  actorName?: string
  sceneId?: string
  tokenId?: string
  oocAlias?: string
}): ChatSpeakerData {
  if (opts.outOfCharacter) {
    return opts.oocAlias ? { alias: opts.oocAlias } : {}
  }
  const speaker: ChatSpeakerData = { actor: opts.actorId }
  if (opts.sceneId) speaker.scene = opts.sceneId
  if (opts.tokenId) speaker.token = opts.tokenId
  if (opts.actorName) speaker.alias = opts.actorName
  return speaker
}

// Assemble the full create payload. Whisper recipients are user ids the caller
// has already resolved; an empty array is omitted so the message stays public.
// The tablemate.originUserId flag preserves attribution parity with the GM path
// (foundry/listener.ts stamps the same flag), so the app's author/whisper
// resolution reads a directly-posted message exactly like a proxied one.
export function buildChatMessageCreateData(opts: {
  userId: string
  speaker: ChatSpeakerData
  content: string
  whisperIds?: string[]
}): ChatMessageCreateData {
  const data: ChatMessageCreateData = {
    author: opts.userId,
    speaker: opts.speaker,
    content: opts.content,
    flags: { tablemate: { originUserId: opts.userId } }
  }
  if (opts.whisperIds && opts.whisperIds.length) data.whisper = opts.whisperIds
  return data
}
