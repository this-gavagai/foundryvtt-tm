// Emoji reactions on chat messages — shared by both ends.
//
// Foundry has no reaction concept, so this is entirely ours: reactions live in
// `flags.tablemate.reactions` on the ChatMessage document, which means they ride
// the existing document sync (the modifyDocument broadcast → serverEventWiring →
// world.messages), land in the IndexedDB chat cache for free, and are readable
// from the Foundry client too.
//
// Shape note — this is a FLAT array of {emoji, userId} pairs, deliberately not a
// map of emoji → userId[]. Remote document updates are folded in with lodash
// mergeWith + mergeWithArrayReset (api/documents.ts), which replaces arrays
// wholesale but merges objects key-by-key. With a map, removing the last
// reaction of an emoji makes Foundry broadcast its deletion syntax
// (`flags.tablemate.reactions.-=👍`), which the merge would happily install as a
// literal key named `-=👍` — leaving a phantom chip on every other client until
// the next full world refresh. One array always resets as a unit.
//
// Storage is bounded: the handler validates every emoji against REACTION_EMOJI
// and only ever writes the requesting user's own id, so a message can hold at
// most REACTION_EMOJI.length × (world users) entries.

export interface ChatReaction {
  emoji: string
  userId: string
}

// A fixed palette rather than a full emoji picker: a mobile PWA shouldn't ship
// an emoji dataset for this, and a short row is a single tap on a phone. Both
// ends import this list — the Foundry handler rejects anything outside it, so
// the set is enforced, not merely suggested.
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '🎉', '🎲'] as const

export type ReactionEmoji = (typeof REACTION_EMOJI)[number]

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && (REACTION_EMOJI as readonly string[]).includes(value)
}

// Loose structural view of the flag carriers on both sides: the app's plain
// ChatMessageData, and Foundry's ChatMessage document (which may answer through
// getFlag, a nested flags object, or — on a freshly broadcast update — a dotted
// key). Mirrors how the voice-memo/image flags are read in useChatMessages.
export interface ReactionFlagSource {
  // The flag bag, keyed by scope. Typed as the index signature Foundry gives a
  // document's `flags` rather than as `{ tablemate: … }`, so a real ChatMessage
  // satisfies this alongside the app's plain wire shapes — the narrower spelling
  // shared no properties with ChatMessageFlagsPF2e, which is what forced the
  // Foundry-side callers to assert their way in.
  flags?: Record<string, unknown> | null
  'flags.tablemate.reactions'?: unknown
  getFlag?: (scope: string, key: string) => unknown
}

// Coerce whatever is stored into a clean pair list. Anything unrecognized is
// dropped rather than trusted: the flag is world-writable data that a stale app
// build (or a hand-edited document) could have shaped differently.
export function normalizeReactions(value: unknown): ChatReaction[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: ChatReaction[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { emoji, userId } = entry as { emoji?: unknown; userId?: unknown }
    if (!isReactionEmoji(emoji)) continue
    if (typeof userId !== 'string' || !userId) continue
    // One reaction per (emoji, user) — a duplicate would double a count.
    // '|' as the delimiter appears in neither a palette emoji nor a Foundry
    // user id, matching the chat cache's key convention.
    const key = `${emoji}|${userId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ emoji, userId })
  }
  return out
}

export function readReactions(source: ReactionFlagSource | null | undefined): ChatReaction[] {
  if (!source) return []
  const flagged = source.getFlag?.('tablemate', 'reactions')
  const scope = source.flags?.['tablemate'] as { reactions?: unknown } | null | undefined
  return normalizeReactions(
    (Array.isArray(flagged) ? flagged : undefined) ??
      scope?.reactions ??
      source['flags.tablemate.reactions']
  )
}

// Add this user's reaction, or remove it if it's already there. Returns a new
// array (never mutates) so callers can diff old vs new.
export function toggleReaction(
  current: ChatReaction[],
  emoji: string,
  userId: string
): ChatReaction[] {
  const existing = current.some((r) => r.emoji === emoji && r.userId === userId)
  if (existing) return current.filter((r) => !(r.emoji === emoji && r.userId === userId))
  return [...current, { emoji, userId }]
}

export interface ReactionGroup {
  emoji: string
  count: number
  // Whether the viewing user is among the reactors — drives the highlighted chip
  // and means the next tap removes rather than adds.
  mine: boolean
  // Display names of the reactors, for the chip's tooltip/accessible label.
  names: string[]
}

// Collapse the pair list into one chip per emoji, ordered by REACTION_EMOJI so
// chips never reorder as counts change (a chip that moves under the finger
// between taps is how you react with the wrong emoji).
//
// `selfUserId` is matched EXACTLY — deliberately not through the belongsTo
// user-identity set used for whisper visibility. A reaction is written under the
// requesting user's own id, so treating a linked user's reaction as "mine" would
// show a filled chip whose next tap adds a second reaction instead of removing
// the one shown.
export function groupReactions(
  reactions: ChatReaction[],
  options: { selfUserId?: string | null; nameFor?: (userId: string) => string | undefined } = {}
): ReactionGroup[] {
  const byEmoji = new Map<string, ChatReaction[]>()
  for (const reaction of reactions) {
    const bucket = byEmoji.get(reaction.emoji)
    if (bucket) bucket.push(reaction)
    else byEmoji.set(reaction.emoji, [reaction])
  }

  const groups: ReactionGroup[] = []
  for (const emoji of REACTION_EMOJI) {
    const bucket = byEmoji.get(emoji)
    if (!bucket?.length) continue
    groups.push({
      emoji,
      count: bucket.length,
      mine: !!options.selfUserId && bucket.some((r) => r.userId === options.selfUserId),
      names: bucket.map((r) => options.nameFor?.(r.userId) ?? r.userId)
    })
  }
  return groups
}

// ── Author-owned storage ────────────────────────────────────────────────────
//
// Reactions are stored on the REACTING USER's own document, not on the message:
// `flags.tablemate.reactions` on User. A reaction is the reactor's, and Foundry
// lets a user write their own document — so the app writes it directly over
// modifyDocument as itself, with no GM client in the loop. That is the whole
// reason for the move: on the message it was a write to someone else's document,
// which only the author or a GM may make, so it needed the proxy.
//
// Two properties fall out for free, rather than being engineered:
//
//   • Contention disappears. Every writer touches only their own row, so two
//     people reacting at once cannot clobber each other and nothing has to be
//     serialized. The message-flag version was a read-modify-write that the GM's
//     dispatch chain had to protect.
//   • "Only your own reaction" stops being a rule a handler enforces and becomes
//     a property of the storage. There is no request to contain.
//
// SHAPE: one flat array of {messageId, emoji}, deliberately NOT a map keyed by
// message id — which is what a per-user store first suggests. Remote updates are
// folded in with lodash mergeWith + mergeWithArrayReset (api/documents.ts),
// which replaces arrays wholesale but merges objects key-by-key; with a map,
// dropping your last reaction on a message makes Foundry broadcast its deletion
// syntax (`flags.tablemate.reactions.-=<id>`) and the merge installs a literal
// key called `-=<id>`. That is the same trap the message-flag shape note above
// describes, and it bites harder here, since a phantom key would carry a whole
// message's worth of reactions. One array always resets as a unit.

/** One reaction as its author stores it. The reactor is the document's owner. */
export interface UserReaction {
  messageId: string
  emoji: string
}

// Ceiling per user, oldest dropped first. Needed rather than tidy: this rides in
// core's world dump on every connect, so without a cap a long-running world
// would grow the payload forever. Generous enough that it is only ever reached
// by history nobody is looking at any more — a reaction on a message hundreds of
// sessions old is not worth a byte.
export const USER_REACTION_MAX = 500

/** The flag bag on a User, structurally so a document or plain JSON both fit. */
export interface UserFlagSource {
  _id?: string | null
  flags?: Record<string, unknown> | null
  getFlag?: (scope: string, key: string) => unknown
}

export function normalizeUserReactions(value: unknown): UserReaction[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: UserReaction[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { messageId, emoji } = entry as { messageId?: unknown; emoji?: unknown }
    if (typeof messageId !== 'string' || !messageId) continue
    // The palette is still enforced on read, not merely on write: the flag is
    // world-readable data, and a stale build or a hand-edited document could
    // hold anything. Rendering is where it would land.
    if (!isReactionEmoji(emoji)) continue
    const key = `${messageId}|${emoji}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ messageId, emoji })
  }
  return out.slice(-USER_REACTION_MAX)
}

export function readUserReactions(user: UserFlagSource | null | undefined): UserReaction[] {
  if (!user) return []
  const flagged = user.getFlag?.('tablemate', 'reactions')
  const scope = user.flags?.['tablemate'] as { reactions?: unknown } | null | undefined
  return normalizeUserReactions((Array.isArray(flagged) ? flagged : undefined) ?? scope?.reactions)
}

/**
 * Add this user's reaction to a message, or remove it if it is already there.
 * Returns a new array; never mutates.
 *
 * A newly added reaction goes on the END, so the cap above drops the oldest.
 */
export function toggleUserReaction(
  current: UserReaction[],
  messageId: string,
  emoji: string
): UserReaction[] {
  const has = current.some((r) => r.messageId === messageId && r.emoji === emoji)
  if (has) return current.filter((r) => !(r.messageId === messageId && r.emoji === emoji))
  return [...current, { messageId, emoji }].slice(-USER_REACTION_MAX)
}

/**
 * Collapse every user's reactions into one message-keyed index.
 *
 * Built once per change to any user rather than per rendered row: a chat log
 * holds thousands of messages and a table holds a couple of dozen users, so the
 * scan is over the small collection and every row is then an O(1) lookup.
 *
 * `legacy` folds in reactions still stored on the MESSAGE by an older build. It
 * is a union rather than a fallback: during a rollover the same message can
 * carry old reactions on itself and new ones on their authors, and showing only
 * one set would make reactions appear to vanish. Dedup is by (message, emoji,
 * user), so a reaction written both ways counts once.
 */
export function indexUserReactions(
  users: Iterable<UserFlagSource> | null | undefined,
  legacy?: Iterable<{ _id?: string | null; reactions: ChatReaction[] }> | null
): Map<string, ChatReaction[]> {
  const index = new Map<string, ChatReaction[]>()
  const seen = new Set<string>()

  const add = (messageId: string, reaction: ChatReaction) => {
    const key = `${messageId}|${reaction.emoji}|${reaction.userId}`
    if (seen.has(key)) return
    seen.add(key)
    const bucket = index.get(messageId)
    if (bucket) bucket.push(reaction)
    else index.set(messageId, [reaction])
  }

  for (const user of users ?? []) {
    const userId = user?._id
    if (typeof userId !== 'string' || !userId) continue
    for (const { messageId, emoji } of readUserReactions(user)) add(messageId, { emoji, userId })
  }
  for (const entry of legacy ?? []) {
    const messageId = entry?._id
    if (typeof messageId !== 'string' || !messageId) continue
    for (const reaction of entry.reactions) add(messageId, reaction)
  }
  return index
}
