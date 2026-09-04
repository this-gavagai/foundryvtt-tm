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
// SHAPE: a map keyed by message id — `{ [messageId]: { e: [...], t } }`. This
// was a flat array until the merge could express a removal, and the history is
// worth keeping because the constraint was ours, not Foundry's: dropping your
// last reaction on a message makes Foundry broadcast `-=<id>`, which is perfectly
// good deletion syntax that lodash knew nothing about, so the merge installed it
// as a literal key and left a phantom row carrying a whole message's reactions.
// An array sidestepped that by always resetting as a unit.
//
// mergeDocumentChange (api/internal.ts) honours those deletions now, and the map
// is what that fix was for. An array has no unit smaller than itself, so every
// tap rewrote the entire list and broadcast it to the table; a row is about
// sixty bytes. See reactionWritePlan for what actually goes on the wire, and the
// note on USER_REACTION_MAX for what the cap is now measuring.
//
// The message-flag shape note at the top of this file describes the same trap
// one level down, and still applies to the legacy data that read path serves.
//
// ONE writer per document is what makes the array safe to rewrite, and that is a
// claim about the DOCUMENT, not about clients: the same person signed in on two
// devices is two writers of one row, and the loser of a race loses an emoji. The
// window is a single round trip (the User broadcast reaches the other device —
// see the User branch in composables/serverEventWiring), and it is strictly
// better than the message-flag version, which raced across every user at the
// table and needed the GM's dispatch chain to serialize. Left as it is on
// purpose: a last-write-wins register is the right shape for this, and the loss
// is one tap that can be repeated.

/** One reaction as its author stores it. The reactor is the document's owner. */
export interface UserReaction {
  messageId: string
  emoji: string
}

// Ceiling per user, in MESSAGES reacted to, oldest dropped first. Needed rather
// than tidy: this rides in core's world dump on every connect, so without a cap
// a long-running world would grow the payload forever.
//
// 200 rather than the 500 reactions it replaced, and the unit changed with it.
// A stored row is one message id, its emoji, and the moment it was first reacted
// to — about 55 bytes — so the whole flag is ~11 KB at the cap, against 24 KB
// before. The reason it can be smaller is that it no longer has to be generous:
// a tap used to rewrite the entire list, so the cap was also the cost of every
// tap, and lowering it meant losing history to save bandwidth. A tap now writes
// one row (see reactionWritePlan), which makes the cap purely about how much
// history is worth carrying on connect.
export const USER_REACTION_MAX = 200

/** The flag bag on a User, structurally so a document or plain JSON both fit. */
export interface UserFlagSource {
  _id?: string | null
  flags?: Record<string, unknown> | null
  getFlag?: (scope: string, key: string) => unknown
}

// ── The stored shape ────────────────────────────────────────────────────────
//
// One row per MESSAGE — `{ [messageId]: { e: ['👍'], t: <first reacted at> } }`
// — rather than the flat array this used to be.
//
// The array existed because a map could not express a removal: Foundry
// broadcasts `flags.tablemate.reactions.-=<id>` when a key goes, and the app's
// merge installed that as a literal property, leaving a phantom row carrying a
// whole message's reactions. That is fixed at the source (mergeDocumentChange in
// api/internal.ts), and the map is what the fix was for: a tap now writes the
// one row it changed instead of the whole list.
//
// `t` is not decoration. The cap drops the oldest rows, and a map has no
// inherent order to drop by — key insertion order is a V8 behaviour, not a
// guarantee that survives a JSON round trip through the server. Storing when the
// row was first written makes the trim well-defined; an edit to an existing row
// keeps its original `t`, so reacting again to an old message does not promote
// it past newer ones.
export interface StoredReactionRow {
  e: string[]
  t: number
}
export type StoredUserReactions = Record<string, StoredReactionRow>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// Coerce whatever is stored — the map, or an array written by an older build —
// into rows. Anything unrecognized is dropped rather than trusted: this flag is
// world-readable data that a stale app (or a hand-edited document) could have
// shaped differently, and rendering is where it would land.
export function normalizeStoredReactions(value: unknown): StoredUserReactions {
  const rows: StoredUserReactions = {}
  const push = (messageId: string, emoji: unknown, at: number) => {
    if (!isReactionEmoji(emoji)) return
    const row = (rows[messageId] ??= { e: [], t: at })
    // One entry per (message, emoji): a duplicate would double a count.
    if (!row.e.includes(emoji)) row.e.push(emoji)
    row.t = Math.min(row.t, at)
  }

  if (Array.isArray(value)) {
    // Legacy: a flat list with no timestamps. Position IS the order there, so
    // it becomes the order here — earlier entries read as older.
    value.forEach((entry, i) => {
      if (!isRecord(entry)) return
      const { messageId, emoji } = entry
      if (typeof messageId !== 'string' || !messageId) return
      push(messageId, emoji, i)
    })
  } else if (isRecord(value)) {
    for (const [messageId, row] of Object.entries(value)) {
      if (!messageId || !isRecord(row)) continue
      const at = typeof row.t === 'number' && Number.isFinite(row.t) ? row.t : 0
      const emojis = Array.isArray(row.e) ? row.e : []
      for (const emoji of emojis) push(messageId, emoji, at)
    }
  }

  for (const [messageId, row] of Object.entries(rows)) if (!row.e.length) delete rows[messageId]
  return trimStoredReactions(rows)
}

/** Newest last, so the cap drops from the front. */
function orderedMessageIds(rows: StoredUserReactions): string[] {
  return Object.keys(rows).sort((a, b) => rows[a].t - rows[b].t)
}

export function trimStoredReactions(rows: StoredUserReactions): StoredUserReactions {
  const ordered = orderedMessageIds(rows)
  if (ordered.length <= USER_REACTION_MAX) return rows
  for (const messageId of ordered.slice(0, ordered.length - USER_REACTION_MAX))
    delete rows[messageId]
  return rows
}

export function normalizeUserReactions(value: unknown): UserReaction[] {
  const rows = normalizeStoredReactions(value)
  const out: UserReaction[] = []
  for (const messageId of orderedMessageIds(rows)) {
    for (const emoji of rows[messageId].e) out.push({ messageId, emoji })
  }
  return out
}

/** The raw stored value, before normalizing — what a write plan starts from. */
export function storedUserReactions(user: UserFlagSource | null | undefined): unknown {
  if (!user) return undefined
  const flagged = user.getFlag?.('tablemate', 'reactions')
  const scope = user.flags?.['tablemate'] as { reactions?: unknown } | null | undefined
  return flagged ?? scope?.reactions
}

export function readUserReactions(user: UserFlagSource | null | undefined): UserReaction[] {
  return normalizeUserReactions(storedUserReactions(user))
}

/**
 * Add this user's reaction to a message, or remove it if it is already there.
 * Returns a new array; never mutates.
 */
export function toggleUserReaction(
  current: UserReaction[],
  messageId: string,
  emoji: string
): UserReaction[] {
  const has = current.some((r) => r.messageId === messageId && r.emoji === emoji)
  if (has) return current.filter((r) => !(r.messageId === messageId && r.emoji === emoji))
  return [...current, { messageId, emoji }]
}

/** The stored form of a whole list, for a caller that must rewrite it entire. */
export function reactionsToStored(list: UserReaction[], now = Date.now()): StoredUserReactions {
  const rows: StoredUserReactions = {}
  list.forEach(({ messageId, emoji }, i) => {
    if (!isReactionEmoji(emoji)) return
    const row = (rows[messageId] ??= { e: [], t: now + i })
    if (!row.e.includes(emoji)) row.e.push(emoji)
  })
  return trimStoredReactions(rows)
}

/**
 * What to send, and what the flag will hold afterwards, for one message's
 * reactions changing.
 *
 * This is the whole point of the map shape. `patch` is what goes on the wire:
 * normally the single row that changed, or Foundry's `-=<id>` when the last
 * emoji on a message goes, plus a `-=` for anything the cap pushed out. A tap
 * costs about sixty bytes instead of the entire list.
 *
 * `whole` marks the one case that cannot be a patch: a flag still holding the
 * legacy array. Merging a map into an array is not a merge, so the first write
 * after the rollover replaces the value outright — Foundry overwrites rather
 * than recurses when the two sides are different types. It happens once per user.
 *
 * `next` is the same change applied in full, for the optimistic local write. The
 * local copy has no reason to be minimal, and reconstructing the patch's effect
 * by hand is how a mirror drifts from what was sent.
 */
export function reactionWritePlan(
  stored: unknown,
  messageId: string,
  emojis: string[],
  now = Date.now()
): { patch: Record<string, unknown>; next: StoredUserReactions; whole: boolean } {
  const whole = !isRecord(stored)
  const next = normalizeStoredReactions(stored)
  const before = new Set(Object.keys(next))

  const kept = emojis.filter(isReactionEmoji)
  if (kept.length) {
    // An edit keeps the row's original `t`: reacting again to an old message
    // should not promote it past newer ones in the trim order.
    next[messageId] = { e: kept, t: next[messageId]?.t ?? now }
  } else {
    delete next[messageId]
  }
  trimStoredReactions(next)

  if (whole) return { patch: { ...next }, next, whole }

  const patch: Record<string, unknown> = {}
  if (next[messageId]) patch[messageId] = next[messageId]
  // Every row that was there and is not any more — the toggled-off message, and
  // whatever the cap dropped — named for deletion.
  for (const id of before) if (!next[id]) patch[`-=${id}`] = null
  if (!next[messageId] && before.has(messageId)) patch[`-=${messageId}`] = null
  return { patch, next, whole }
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
