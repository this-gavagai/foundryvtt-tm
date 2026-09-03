// Free-text comments on a chat message — shared by both ends.
//
// Foundry has no concept of a remark ON a message, so like reactions this is
// entirely ours: comments live in `flags.tablemate.comments` on the ChatMessage
// document, which means they ride the existing document sync (the modifyDocument
// broadcast → serverEventWiring → world.messages), land in the IndexedDB chat
// cache for free, and are readable from the Foundry client too.
//
// Why a LIST rather than one string per message: a roll gets talked about by
// more than one person — the GM narrating the hit, the player who made it
// explaining what they were going for — and a single field makes the second
// writer overwrite the first. Each comment carries its own author, which is also
// what makes "you may edit your own" expressible at all.
//
// Shape note — this is a flat array for the same reason the reaction list is
// (see utils/chatReactions.ts): remote document updates are folded in with
// lodash mergeWith + mergeWithArrayReset (api/documents.ts), which replaces
// arrays wholesale but merges objects key-by-key. A map keyed by comment id
// would leave phantom entries behind when one is deleted, because Foundry
// broadcasts its deletion syntax (`-=<id>`) which the merge installs as a
// literal key.
//
// Storage is bounded: text is capped at COMMENT_MAX_LENGTH and a message holds
// at most COMMENT_MAX_COUNT comments, so the flag can't grow without limit on a
// message everyone talks over.

export interface ChatComment {
  // Stable per-comment id, so an edit or a removal names ONE comment rather than
  // an index into a list two clients may disagree about.
  id: string
  // The comment's author — NOT the message's. This is what the "edit your own"
  // rule is checked against, on both ends.
  userId: string
  // Plain text. Never HTML: it is rendered as text in the app and written with
  // textContent in the Foundry chat log, so a comment can't inject markup.
  text: string
  timestamp: number
}

// Long enough for a sentence or three of colour ("the blade skitters off the
// helm, but you see an opening"), short enough that the flag stays small on a
// message that collects a dozen of them.
export const COMMENT_MAX_LENGTH = 500

// Ceiling per message. Reached only by deliberate spamming; the handler drops
// the oldest comment rather than refusing the write, so the last thing said
// always lands.
export const COMMENT_MAX_COUNT = 20

// Loose structural view of the flag carriers on both sides: the app's plain
// ChatMessageData, and Foundry's ChatMessage document (which may answer through
// getFlag, a nested flags object, or — on a freshly broadcast update — a dotted
// key). Mirrors ReactionFlagSource in utils/chatReactions.ts.
export interface CommentFlagSource {
  flags?: Record<string, unknown> | null
  'flags.tablemate.comments'?: unknown
  getFlag?: (scope: string, key: string) => unknown
}

// Trim a comment to what may be stored: surrounding whitespace gone, runs of
// blank lines collapsed (a pasted block shouldn't push the rest of the log off
// the screen), and capped. Returns '' for anything that isn't usable text —
// callers treat that as "remove this comment".
export function sanitizeCommentText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, COMMENT_MAX_LENGTH)
}

// Coerce whatever is stored into a clean comment list. Anything unrecognized is
// dropped rather than trusted: the flag is world-writable data that a stale app
// build (or a hand-edited document) could have shaped differently.
export function normalizeComments(value: unknown): ChatComment[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: ChatComment[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, userId, text, timestamp } = entry as {
      id?: unknown
      userId?: unknown
      text?: unknown
      timestamp?: unknown
    }
    if (typeof id !== 'string' || !id) continue
    if (typeof userId !== 'string' || !userId) continue
    // A comment with no text is not a comment — that state is spelled "removed".
    const clean = sanitizeCommentText(text)
    if (!clean) continue
    // One entry per id; a duplicate would render twice and make an edit
    // ambiguous.
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      userId,
      text: clean,
      timestamp: typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0
    })
  }
  // Oldest first, as they were said. Ties keep insertion order (Array.sort is
  // stable), so comments written in the same millisecond don't shuffle.
  return out.sort((a, b) => a.timestamp - b.timestamp).slice(-COMMENT_MAX_COUNT)
}

export function readComments(source: CommentFlagSource | null | undefined): ChatComment[] {
  if (!source) return []
  const flagged = source.getFlag?.('tablemate', 'comments')
  const scope = source.flags?.['tablemate'] as { comments?: unknown } | null | undefined
  return normalizeComments(
    (Array.isArray(flagged) ? flagged : undefined) ??
      scope?.comments ??
      source['flags.tablemate.comments']
  )
}

export function findComment(
  comments: ChatComment[],
  commentId: string | null | undefined
): ChatComment | undefined {
  if (!commentId) return undefined
  return comments.find((comment) => comment.id === commentId)
}

// Add a comment, or replace the one it names. Returns a new array (never
// mutates) so callers can diff old vs new. An edit keeps the comment's position
// in the list — a corrected typo shouldn't jump it to the bottom of the thread —
// and keeps its original timestamp, which is what that position means.
export function upsertComment(current: ChatComment[], comment: ChatComment): ChatComment[] {
  const index = current.findIndex((entry) => entry.id === comment.id)
  if (index === -1) return [...current, comment].slice(-COMMENT_MAX_COUNT)
  const next = [...current]
  next[index] = { ...comment, timestamp: current[index].timestamp }
  return next
}

export function removeComment(current: ChatComment[], commentId: string): ChatComment[] {
  return current.filter((comment) => comment.id !== commentId)
}

// Who may change an existing comment: its author, or a GM (who can moderate the
// log the same way they can delete any message).
//
// This is the one rule that stayed narrow. Anyone may ADD a comment to any
// message — a table talks about each other's rolls, and that is the point — but
// nobody gets to rewrite what someone else said under their name.
export function canModifyComment(
  comment: ChatComment,
  userIds: ReadonlySet<string> | string | null | undefined,
  isGM: boolean
): boolean {
  if (isGM) return true
  if (!userIds) return false
  return typeof userIds === 'string' ? comment.userId === userIds : userIds.has(comment.userId)
}

// ── Author-owned storage ────────────────────────────────────────────────────
//
// Comments are stored on their AUTHOR's own document — `flags.tablemate.comments`
// on User — for the same reason reactions are (see utils/chatReactions.ts), and
// one sharper: a roll made from the app is POSTED BY the GM's client, so its
// ChatMessage author is the GM. Even the roller's own roll was not theirs to
// update, which is why writing a comment needed the proxy at all.
//
// What this buys beyond removing that dependency: the "only a comment's author
// may rewrite it" rule stops being a rule. It was enforced in the handler
// (canModifyComment, below, against a self-reported userId that Foundry's module
// channel cannot authenticate); now it is Foundry's own document permission —
// a player may write their own User and no one else's. The check that used to
// be trusted code is now the database's.
//
// GM moderation still works, and directly: `common/documents/user.mjs` grants a
// full GM update rights on any User, so a GM removing someone else's comment is
// an ordinary write from their own client. What that permission does NOT do is
// pick the document — a moderating write has to be addressed at the comment's
// author rather than at the writer, which is composables/useChatComments.ts's
// job and was the one thing missing when this moved.
//
// ONE capability was lost in the move, deliberately. A sheet-only user attached
// to a human through `flags.tablemate.belongsTo` can no longer edit a comment
// written under the other identity: the old handler widened "your own" across
// the pair (commentIdentityIds, still used by the legacy shim), and a document
// permission cannot. READING still treats them as the same person, so a comment
// written from either reads as that human's; only cross-identity EDITING is
// gone. Judged an acceptable trade — it needs one person logged in as both
// identities at different times — but it is a real regression, not an
// oversight, and nothing mitigates it.
//
// SHAPE: a flat array of comments carrying their own `messageId`, not a map
// keyed by message — see the shape note in utils/chatReactions.ts for why a map
// on a per-user store is a trap. `userId` is GONE from the stored form: the
// author is the document it sits on, so storing it again invites the two to
// disagree. It is reattached on read, where every consumer still expects it.

/** One comment as its author stores it. The author is the document's owner. */
export interface UserComment {
  id: string
  messageId: string
  text: string
  timestamp: number
}

// Ceiling per author, oldest dropped first — the same reasoning as
// USER_REACTION_MAX, with a tighter number because a comment is free text
// rather than one of six emoji. COMMENT_MAX_COUNT still bounds how many can
// pile onto any ONE message; this bounds the author's whole history.
export const USER_COMMENT_MAX = 200

export function normalizeUserComments(value: unknown): UserComment[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: UserComment[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, messageId, text, timestamp } = entry as {
      id?: unknown
      messageId?: unknown
      text?: unknown
      timestamp?: unknown
    }
    if (typeof id !== 'string' || !id) continue
    if (typeof messageId !== 'string' || !messageId) continue
    // A comment with no text is not a comment — that state is spelled "removed".
    const clean = sanitizeCommentText(text)
    if (!clean) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      messageId,
      text: clean,
      timestamp: typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0
    })
  }
  return out.slice(-USER_COMMENT_MAX)
}

export function readUserComments(
  user:
    | { flags?: Record<string, unknown> | null; getFlag?: (s: string, k: string) => unknown }
    | null
    | undefined
): UserComment[] {
  if (!user) return []
  const flagged = user.getFlag?.('tablemate', 'comments')
  const scope = user.flags?.['tablemate'] as { comments?: unknown } | null | undefined
  return normalizeUserComments((Array.isArray(flagged) ? flagged : undefined) ?? scope?.comments)
}

/**
 * Add a comment, replace the one it names, or remove it when `text` is empty.
 * Returns a new array; never mutates.
 *
 * An edit keeps the comment's original timestamp — a corrected typo should not
 * jump it to the bottom of the thread — which is what its position means.
 */
export function upsertUserComment(current: UserComment[], comment: UserComment): UserComment[] {
  const index = current.findIndex((entry) => entry.id === comment.id)
  if (!comment.text) return current.filter((entry) => entry.id !== comment.id)
  if (index === -1) return [...current, comment].slice(-USER_COMMENT_MAX)
  const next = [...current]
  next[index] = { ...comment, timestamp: current[index].timestamp }
  return next
}

/**
 * Collapse every author's comments into one message-keyed index, in the
 * resolved ChatComment shape every consumer already reads.
 *
 * Ordering matters more here than for reactions: a thread read out of order
 * reads as a different conversation. Sorted by timestamp within each message,
 * which is what makes cross-author ordering work at all — the authors write to
 * separate documents, so nothing but the clock relates their entries.
 *
 * `legacy` folds in comments still stored on the MESSAGE by an older build, as a
 * union rather than a fallback (see indexUserReactions).
 */
export function indexUserComments(
  users:
    | Iterable<{ _id?: string | null; flags?: Record<string, unknown> | null }>
    | null
    | undefined,
  legacy?: Iterable<{ _id?: string | null; comments: ChatComment[] }> | null
): Map<string, ChatComment[]> {
  const index = new Map<string, ChatComment[]>()
  const seen = new Set<string>()

  const add = (messageId: string, comment: ChatComment) => {
    if (seen.has(comment.id)) return
    seen.add(comment.id)
    const bucket = index.get(messageId)
    if (bucket) bucket.push(comment)
    else index.set(messageId, [comment])
  }

  for (const user of users ?? []) {
    const userId = user?._id
    if (typeof userId !== 'string' || !userId) continue
    // The author is reattached here: it is the document, not stored data.
    for (const stored of readUserComments(user)) {
      add(stored.messageId, {
        id: stored.id,
        userId,
        text: stored.text,
        timestamp: stored.timestamp
      })
    }
  }
  for (const entry of legacy ?? []) {
    const messageId = entry?._id
    if (typeof messageId !== 'string' || !messageId) continue
    for (const comment of entry.comments) add(messageId, comment)
  }

  for (const [messageId, bucket] of index) {
    index.set(
      messageId,
      // Stable sort, so two comments in the same millisecond keep the order
      // they were collected in rather than shuffling between renders.
      [...bucket].sort((a, b) => a.timestamp - b.timestamp).slice(-COMMENT_MAX_COUNT)
    )
  }
  return index
}
