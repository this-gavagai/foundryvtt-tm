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
  flags?: { tablemate?: { reactions?: unknown } | null } | null
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
  return normalizeReactions(
    (Array.isArray(flagged) ? flagged : undefined) ??
      source.flags?.tablemate?.reactions ??
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
