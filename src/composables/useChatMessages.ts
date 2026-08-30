import { computed, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { useChatStore } from '@/stores/chat'
import { useUserStore } from '@/stores/user'
import { getMediaPath } from '@/utils/utilities'
import { tokenPortrait, type PortraitRing } from '@/utils/tokenPortrait'
import { prepareChatHtml } from '@/utils/chatHtml'
import { rollSummaries, type ChatRollSummary, type RollJson } from '@/utils/chatRollSummary'
import { applyPf2eNotation } from '@/utils/pf2eEnrich'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import { useChatVisibility, type UserData } from '@/composables/useChatVisibility'
import {
  groupReactions,
  readReactions,
  type ChatReaction,
  type ReactionGroup
} from '@/utils/chatReactions'
import { canModifyComment, readComments, type ChatComment } from '@/utils/chatComments'
import type { ActiveRoll } from '@/types/api-types'

interface ChatSpeaker {
  alias?: string
  actor?: string
  scene?: string
  token?: string
}

export interface ChatMessageData {
  _id?: string | null
  author?: string | { _id?: string | null; name?: string | null } | null
  user?: string | null
  timestamp?: number | null
  flavor?: string | null
  content?: string | null
  speaker?: ChatSpeaker | null
  whisper?: string[]
  blind?: boolean
  rolls?: Array<string | RollJson>
  type?: string
  flags?: {
    tablemate?: {
      originUserId?: string | null
      // Voice-memo attachment: the uploaded audio's world-relative path plus
      // its container type and length. Written by foundrySendVoiceMemo; the
      // row renders a native <audio> from it (the sanitizer strips <audio>
      // from the message content, so it can't ride there). See chat.ts.
      audioPath?: string | null
      audioMimeType?: string | null
      audioDurationMs?: number | null
      // AI transcription of the memo, patched on by the app that recorded it
      // when that device has transcription configured (see api/transcription.ts).
      // Absent when transcription is off there, or the call failed.
      transcript?: string | null
      // Image attachment: the uploaded image's world-relative path plus its
      // MIME type and pixel dimensions. Written by foundrySendImage; the row
      // renders a native <img> from it (the content copy rides in a stripped
      // [data-tablemate-image] wrapper so it doesn't render twice). See chat.ts.
      imagePath?: string | null
      imageMimeType?: string | null
      imageWidth?: number | null
      imageHeight?: number | null
      // Emoji reactions: a flat list of {emoji, userId} pairs. Written GM-side
      // by foundryToggleReaction (a player can't update another user's message),
      // and read through utils/chatReactions.ts. See the shape note there for
      // why this is an array rather than an emoji → users map.
      reactions?: ChatReaction[] | null
      // Free-text comments about this message, from anyone at the table.
      // Written GM-side by foundrySetComment (a roll is authored by the GM
      // client that rolled it, so not even the roller can write it directly),
      // and read through utils/chatComments.ts.
      comments?: ChatComment[] | null
    }
    pf2e?: {
      origin?: {
        uuid?: string | null
        // Rank the spell was actually cast at, and the spell-variant overlays
        // the card is currently showing. Both are written by PF2e when the card
        // is posted (and rewritten when a variant button swaps the card), and
        // together they identify the cast a card button should roll for — the
        // base spell item alone would roll at the wrong rank and without the
        // variant's damage.
        castRank?: number | null
        variant?: { overlays?: string[] | null } | null
      }
      // The spellcasting entry the cast came from. Needed to resolve the right
      // attack statistic for a spell that appears in more than one entry.
      casting?: { id?: string | null } | null
      context?: {
        isReroll?: boolean | null
        options?: unknown
      }
    }
  }
  isReroll?: boolean
  isRerollable?: boolean
  'flags.tablemate.originUserId'?: string | null
  getFlag?: (scope: string, key: string) => unknown
}

// Only the fields the portrait derivation reads; `tokenPortrait` is structurally
// typed so a placed TokenDocument and a prototype token both fit.
interface ChatTokenData {
  _id?: string | null
  actorId?: string | null
  texture?: {
    src?: string | null
    scaleX?: number | null
    scaleY?: number | null
  }
  ring?: ChatTokenRing
  width?: number | null
  height?: number | null
}

interface ChatTokenRing {
  enabled?: boolean | null
  colors?: { ring?: string | null; background?: string | null } | null
  effects?: number | null
  subject?: { texture?: string | null; scale?: number | null } | null
}

interface ChatSceneData {
  _id?: string | null
  active?: boolean
  tokens?: CollectionLike<ChatTokenData>
}

interface ChatActorData {
  _id?: string | null
  img?: string | null
  prototypeToken?: ChatTokenData
}

export interface ChatMessageView {
  message: ChatMessageData
  key: string
  speakerName: string
  authorName: string
  showAuthorName: boolean
  formattedTime: string
  visibilityLabel: string | null
  whisperRecipients: string[]
  isOwnActor: boolean
  // Authored by this client's user (own posts) — drives right-alignment in the
  // bubble layout. Distinct from isOwnActor, which is about the message's actor.
  isOwnMessage: boolean
  // Stable identity of the displayed sender, for grouping consecutive messages.
  senderKey: string
  // Grouping flags for the bubble layout, filled in a second pass over the
  // rendered list: groupStart draws the gutter token and the name/time line above
  // the run, groupEnd rounds off its last bubble.
  groupStart: boolean
  groupEnd: boolean
  hasPortrait: boolean
  // Unresolved token-art path (see speakerPortrait); TokenArt resolves it.
  portrait?: string
  portraitScale: { '--sx': number; '--sy': number }
  // Present when the speaker's token draws a dynamic ring.
  portraitRing?: PortraitRing
  preparedFlavor?: string
  preparedContent?: string
  // Playable URL of an attached voice memo (resolved from flags.tablemate);
  // undefined for non-audio messages.
  audioUrl?: string
  // AI transcript of an attached voice memo, if one was produced GM-side.
  transcript?: string
  // Displayable URL of an attached image (resolved from flags.tablemate);
  // undefined for non-image messages. Its pixel dimensions, when known, let the
  // row reserve space to avoid a reflow as the image loads.
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  showContent: boolean
  showEmptyMessage: boolean
  rerollSummary?: ChatRerollSummary
  rolls: ChatRollSummary[]
  inlineChecks: ActiveRoll[]
  // One chip per reacted emoji, in palette order. Built in the CHEAP pass, not
  // the memoized expensive one: the memo's fingerprint covers content/flavor/
  // rolls only, so a reaction change wouldn't invalidate it and chips would
  // render stale. Also depends on the user list (reactor names), which the memo
  // deliberately doesn't track.
  reactions: ReactionGroup[]
  // Comments on this message, oldest first, with their authors resolved to
  // display names. Built in the CHEAP pass for the same reasons as reactions:
  // the memo's fingerprint doesn't cover the flag, and the names depend on the
  // user list.
  comments: ChatCommentView[]
}

// One comment as the row renders it.
export interface ChatCommentView {
  id: string
  text: string
  // The comment's author, resolved through the belongsTo owner like every other
  // piece of chat attribution.
  authorName: string
  // Written by this user (exact id match, like a reaction's `mine`).
  mine: boolean
  // Whether this user may edit or remove it: its author, or any GM.
  canModify: boolean
}

export interface ChatRerollSummary {
  formula?: string
  oldDie?: number
  newDie?: number
  oldTotal?: number
  newTotal?: number
  oldDiscarded: boolean
  newDiscarded: boolean
}

// The parts of a message view that are expensive to build (HTML sanitize +
// enrich, the reroll DOM parse, the inline-check regex pass) and depend ONLY on
// the message's own content — not on world/scene/actor state. Memoized (see
// makeMessageViewMemo) so a combat tick, which force-triggers the world
// shallowRef and re-runs renderedMessages over the whole visible log, reuses
// these instead of re-parsing every message's HTML each time.
export type ExpensiveMessageView = Pick<
  ChatMessageView,
  | 'preparedFlavor'
  | 'preparedContent'
  | 'showContent'
  | 'showEmptyMessage'
  | 'rerollSummary'
  | 'rolls'
  | 'inlineChecks'
>

// Per-message memo keyed by message id, invalidated by a fingerprint of the
// inputs that actually affect the expensive parts (content, flavor, rolls, and
// the GM-strip flag). Exported for direct unit testing — the composable that
// uses it is store-coupled, but the cache logic is pure.
export function makeMessageViewMemo() {
  const cache = new Map<string, { fingerprint: string; value: ExpensiveMessageView }>()
  return {
    get(
      id: string | undefined,
      fingerprint: string,
      compute: () => ExpensiveMessageView
    ): ExpensiveMessageView {
      if (id) {
        const hit = cache.get(id)
        if (hit && hit.fingerprint === fingerprint) return hit.value
      }
      const value = compute()
      if (id) cache.set(id, { fingerprint, value })
      return value
    },
    // Drop entries for messages no longer visible (log scrolled or trimmed) so
    // the cache tracks the visible tail rather than growing without bound.
    prune(liveIds: Set<string>) {
      if (cache.size <= liveIds.size) return
      for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id)
    },
    get size() {
      return cache.size
    }
  }
}

export function originActorId(message: ChatMessageData): string | undefined {
  const uuid = message.flags?.pf2e?.origin?.uuid
  if (uuid) return /^Actor\.([^.]+)/.exec(uuid)?.[1]
  return message.speaker?.actor ?? undefined
}

export function originItemId(message: ChatMessageData): string | undefined {
  const uuid = message.flags?.pf2e?.origin?.uuid
  if (!uuid) return undefined
  return /\.Item\.([^.]+)$/.exec(uuid)?.[1]
}

// Everything a chat card's roll buttons need to roll for the CAST the card
// represents rather than for the bare spell item: which spell, from which
// spellcasting entry, at what rank, under which variant overlays.
export interface SpellCardCast {
  spellId: string
  entryId: string
  castRank?: number
  overlayIds: string[]
}

export function spellCardCast(message: ChatMessageData): SpellCardCast | undefined {
  const spellId = originItemId(message)
  if (!spellId) return undefined
  const origin = message.flags?.pf2e?.origin
  const castRank = typeof origin?.castRank === 'number' ? origin.castRank : undefined
  const overlays = origin?.variant?.overlays
  return {
    spellId,
    // Empty string is the "no entry named" case the module already handles by
    // searching every collection (see foundry/utils/spellLookup).
    entryId: message.flags?.pf2e?.casting?.id ?? '',
    castRank,
    overlayIds: Array.isArray(overlays) ? overlays.filter((id) => typeof id === 'string') : []
  }
}

export function messageIsReroll(message: ChatMessageData): boolean {
  if (message.isReroll || message.flags?.pf2e?.context?.isReroll) return true
  const options = message.flags?.pf2e?.context?.options
  return Array.isArray(options) && options.includes('check:reroll')
}

function numberFromText(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function rerollPartSummary(root: ParentNode): {
  formula?: string
  die?: number
  total?: number
} {
  return {
    formula:
      root.querySelector<HTMLElement>('.dice-formula:not(.hidden)')?.textContent?.trim() ||
      root.querySelector<HTMLElement>('.dice-formula')?.textContent?.trim() ||
      undefined,
    die: numberFromText(
      root.querySelector<HTMLElement>('.part-total')?.textContent ||
        root.querySelector<HTMLElement>('.dice-rolls .roll.die')?.textContent
    ),
    total: numberFromText(root.querySelector<HTMLElement>('.dice-total')?.textContent)
  }
}

export function parseRerollSummary(
  content: string | null | undefined
): ChatRerollSummary | undefined {
  if (!content || typeof document === 'undefined') return undefined

  const template = document.createElement('template')
  template.innerHTML = content
  const parts = Array.from(template.content.children).filter((element) =>
    element.querySelector('.dice-roll')
  )
  const oldPart = parts[0]
  const newPart = parts.find((element) => element.classList.contains('reroll-second')) ?? parts[1]
  if (!oldPart || !newPart) return undefined

  const oldRoll = rerollPartSummary(oldPart)
  const newRoll = rerollPartSummary(newPart)
  if (
    oldRoll.die === undefined &&
    newRoll.die === undefined &&
    oldRoll.total === undefined &&
    newRoll.total === undefined
  ) {
    return undefined
  }

  return {
    formula: newRoll.formula ?? oldRoll.formula,
    oldDie: oldRoll.die,
    newDie: newRoll.die,
    oldTotal: oldRoll.total,
    newTotal: newRoll.total,
    oldDiscarded: oldPart.classList.contains('reroll-discard'),
    newDiscarded: newPart.classList.contains('reroll-discard')
  }
}

function tablemateOriginUserId(message: ChatMessageData): string | undefined {
  const flagged = message.getFlag?.('tablemate', 'originUserId')
  return (
    (typeof flagged === 'string' ? flagged : undefined) ??
    message.flags?.tablemate?.originUserId ??
    message['flags.tablemate.originUserId'] ??
    undefined
  )
}

// Resolve an attached voice memo's playable URL from a message's tablemate
// flags (getFlag-then-nested, like the origin flag). Uses getMediaPath, not
// getPath, so the clip streams and never enters the icon image cache.
function voiceMemoUrl(message: ChatMessageData): string | undefined {
  const flaggedPath = message.getFlag?.('tablemate', 'audioPath')
  const path =
    (typeof flaggedPath === 'string' ? flaggedPath : undefined) ??
    message.flags?.tablemate?.audioPath ??
    undefined
  if (!path) return undefined
  return getMediaPath(path)
}

// Resolve a voice memo's AI transcript from a message's tablemate flags
// (getFlag-then-nested, like voiceMemoUrl). Empty/whitespace reads as absent.
function voiceMemoTranscript(message: ChatMessageData): string | undefined {
  const flagged = message.getFlag?.('tablemate', 'transcript')
  const text =
    (typeof flagged === 'string' ? flagged : undefined) ??
    message.flags?.tablemate?.transcript ??
    undefined
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

// Resolve an attached image's displayable URL from a message's tablemate flags
// (getFlag-then-nested, like voiceMemoUrl). Uses getMediaPath, not getPath, so a
// full-size photo streams and never evicts real icons from the image LRU.
function imageUrl(message: ChatMessageData): string | undefined {
  const flaggedPath = message.getFlag?.('tablemate', 'imagePath')
  const path =
    (typeof flaggedPath === 'string' ? flaggedPath : undefined) ??
    message.flags?.tablemate?.imagePath ??
    undefined
  if (!path) return undefined
  return getMediaPath(path)
}

function formattedTime(timestamp?: number | null): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(new Date(timestamp))
}

function visibilityLabel(message: ChatMessageData): string | null {
  if (message.blind) return 'chat.blind'
  if (message.whisper?.length) return 'chat.whisper'
  return null
}

function messageKey(message: ChatMessageData, index: number): string {
  return message._id ?? `${message.timestamp ?? 'message'}-${index}`
}

// Consecutive messages within this gap (and otherwise matching) collapse into
// one visual group — the same 5-minute window most chat apps use.
const GROUP_GAP_MS = 5 * 60_000

// Whether `b` continues the same visual group as the message `a` directly above
// it. Same displayed sender, same side (own vs other), same visibility (a
// whisper never joins a public run), and close together in time.
function sameGroup(a: ChatMessageView, b: ChatMessageView): boolean {
  if (a.isOwnMessage !== b.isOwnMessage) return false
  if (a.senderKey !== b.senderKey) return false
  if (a.visibilityLabel !== b.visibilityLabel) return false
  // Distinct whisper audiences don't share a run — the recipient line shown once
  // at the group's top would otherwise misrepresent the rest.
  if (a.whisperRecipients.join('|') !== b.whisperRecipients.join('|')) return false
  const at = a.message.timestamp ?? 0
  const bt = b.message.timestamp ?? 0
  return Math.abs(bt - at) <= GROUP_GAP_MS
}

function plainChatText(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

// Reverse a message's stored HTML back to the plain text the user typed, for
// populating the composer when editing. Own messages are posted as escaped text
// with newlines as <br> (see formatChatContent), so undo that: <br> → newline,
// then textContent both drops any tags and decodes entities.
export function chatContentToEditableText(content: string | null | undefined): string {
  if (!content) return ''
  if (typeof document === 'undefined') return content
  const template = document.createElement('template')
  template.innerHTML = content.replace(/<br\s*\/?>/gi, '\n')
  return (template.content.textContent ?? '').trim()
}

function inlineChecksFromContent(content: string | null | undefined): ActiveRoll[] {
  if (!content) return []
  const checks: ActiveRoll[] = []
  applyPf2eNotation(content, {
    check: (slug, inline, dc, against) => {
      const name = typeof inline.name === 'string' ? inline.name : slug
      const dcSuffix = dc ? ` DC ${dc}` : against ? ` vs ${against}` : ''
      checks.push({
        action: 'check',
        slug,
        label: `${name} Check${dcSuffix}`,
        checkInline: Object.keys(inline).length ? inline : undefined,
        dc,
        against
      })
      return ''
    }
  })
  return checks
}

function shouldShowMessageContent(
  message: ChatMessageData,
  summaries = rollSummaries(message.rolls),
  rerollSummary = parseRerollSummary(message.content)
): boolean {
  if (!message.content) return false
  if (rerollSummary) return false
  if (!summaries.length) return true
  const contentText = plainChatText(message.content)
  return !summaries.some((roll) => roll.total !== undefined && contentText === String(roll.total))
}

export function useChatMessages(currentActorId: Ref<string | null | undefined>) {
  const { world } = storeToRefs(useWorldStore())

  // Whisper/GM gating is shared with the unread store via useChatVisibility so
  // the overlay and the badge count always agree on what's visible.
  const {
    currentUserIsGM,
    messageVisibleToCurrentUser,
    messageIsFromCurrentUser,
    visibleMessages
  } = useChatVisibility()

  // Reactions are keyed by the reacting user's own Foundry id, so "did I react"
  // is an exact match on it — deliberately not the belongsTo-widened
  // currentUserIds set used for whisper visibility. Treating a linked user's
  // reaction as mine would show a filled chip whose next tap adds a second
  // reaction instead of removing the one on screen.
  const userStore = useUserStore()

  const users = computed(() =>
    collectionToArray<UserData>(world.value?.users as CollectionLike<UserData>)
  )

  const userNamesById = computed(() => {
    const names = new Map<string, string>()
    users.value.forEach((user) => {
      if (!user.name) return
      if (user._id) names.set(user._id, user.name)
      if (user.id) names.set(user.id, user.name)
    })
    return names
  })

  // A sheet-only user (e.g. "Peter's Sheet") is attached to a human's primary
  // login user via the tablemate.belongsTo flag, so chat should read as that
  // human ("Peter"). Map each user id to its owner id so attribution resolves
  // through it. Mirrors the same belongsTo lookup in useChatVisibility.
  const ownerIdByUserId = computed(() => {
    const owners = new Map<string, string>()
    users.value.forEach((user) => {
      const owner = user.flags?.tablemate?.belongsTo
      if (typeof owner !== 'string' || !owner) return
      if (user._id) owners.set(user._id, owner)
      if (user.id) owners.set(user.id, owner)
    })
    return owners
  })

  // Resolve a user id to the display name of its owner (the human login user),
  // falling back to the user's own name when there's no belongsTo owner.
  function resolvedUserName(userId: string): string {
    const ownerId = ownerIdByUserId.value.get(userId)
    if (ownerId)
      return userNamesById.value.get(ownerId) ?? userNamesById.value.get(userId) ?? userId
    return userNamesById.value.get(userId) ?? userId
  }
  const scenes = computed(() =>
    collectionToArray<ChatSceneData>(world.value?.scenes as CollectionLike<ChatSceneData>)
  )

  const actorsById = computed(() => {
    const map = new Map<string, ChatActorData>()
    collectionToArray<ChatActorData>(world.value?.actors as CollectionLike<ChatActorData>).forEach(
      (actor) => {
        if (actor._id) map.set(actor._id, actor)
      }
    )
    return map
  })

  // Stale-while-revalidate: the chat store owns the IndexedDB tail (hydration
  // and write-back — it's a singleton, while this composable is instantiated
  // once per mounted sheet); this computed only decides which list to show.
  const chatStore = useChatStore()

  const messages = computed(() => {
    // Once the world payload has arrived it is canonical — show it verbatim
    // (via the shared visibleMessages), even when empty (e.g. messages were
    // deleted). Falling back to the cache whenever `live` is merely empty would
    // resurrect deleted messages, so the cache is only a pre-world placeholder,
    // gated on `world.value` presence.
    if (world.value) return visibleMessages.value
    return chatStore.cachedMessages
      .filter(messageVisibleToCurrentUser)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  })

  function authorName(message: ChatMessageData): string {
    const tablemateOrigin = tablemateOriginUserId(message)
    if (tablemateOrigin) return resolvedUserName(tablemateOrigin)

    if (typeof message.author === 'object' && message.author?.name) return message.author.name
    const authorId = typeof message.author === 'string' ? message.author : (message.user ?? '')
    return authorId ? resolvedUserName(authorId) : authorId
  }

  function speakerName(message: ChatMessageData, resolvedAuthor = authorName(message)): string {
    return message.speaker?.alias || resolvedAuthor || 'Unknown'
  }

  function messageIsOwnActor(message: ChatMessageData): boolean {
    return !!currentActorId.value && originActorId(message) === currentActorId.value
  }

  // Names of the users a whispered message is directed to, resolved from the
  // whisper recipient ids. Unknown ids fall back to the raw id so a recipient is
  // never silently dropped from the displayed list.
  function whisperRecipientNames(message: ChatMessageData): string[] {
    if (!message.whisper?.length) return []
    return message.whisper.map((id) => userNamesById.value.get(id) ?? id)
  }

  function speakerToken(message: ChatMessageData): ChatTokenData | undefined {
    const speaker = message.speaker
    if (!speaker?.token) return undefined
    const scene =
      scenes.value.find((s) => s._id === speaker.scene) ?? scenes.value.find((s) => s.active)
    return collectionToArray(scene?.tokens).find((token) => token._id === speaker.token)
  }

  // Resolve a speaker's portrait, preferring the placed scene token (per-token
  // art, scale and ring) and falling back to the actor's own prototype token.
  // Messages whose speaker carries only an actor — plain chat sent via
  // ChatMessage.getSpeaker, or any actor without a token in the active scene —
  // have no scene token, so without this fallback they render with no portrait
  // at all.
  function speakerPortrait(message: ChatMessageData): {
    src?: string
    scale: { '--sx': number; '--sy': number }
    ring?: PortraitRing
  } {
    const token = speakerToken(message)
    const actorId = message.speaker?.actor
    const actor = actorId ? actorsById.value.get(actorId) : undefined
    const portrait = token?.texture?.src
      ? tokenPortrait(token)
      : tokenPortrait(actor?.prototypeToken, actor?.img ?? undefined)
    return {
      // Unresolved Foundry path: TokenArt runs it through getPath at render
      // time, which on native re-resolves as the image cache fills in.
      src: portrait.url,
      scale: { '--sx': portrait.scaleX, '--sy': portrait.scaleY },
      ring: portrait.ring
    }
  }

  const viewMemo = makeMessageViewMemo()

  // Build (or reuse) the expensive, content-only part of a message view. The
  // fingerprint covers exactly its inputs — content, flavor, rolls, and the GM
  // strip flag — so it's rebuilt only when one of those actually changes (a new
  // message, or an edit like a reroll), not on unrelated world triggers.
  function expensiveView(message: ChatMessageData): ExpensiveMessageView {
    const gm = currentUserIsGM.value
    const fingerprint =
      `${gm ? 'g' : ''} ${message.flavor ?? ''} ${message.content ?? ''}` +
      ` ${message.rolls ? JSON.stringify(message.rolls) : ''}`
    return viewMemo.get(message._id ?? undefined, fingerprint, () => {
      const rolls = rollSummaries(message.rolls)
      const rerollSummary = parseRerollSummary(message.content)
      const showContent = shouldShowMessageContent(message, rolls, rerollSummary)
      return {
        rolls,
        rerollSummary,
        showContent,
        showEmptyMessage: !showContent && !rolls.length,
        preparedFlavor: message.flavor
          ? prepareChatHtml(message.flavor, { stripGmContent: !gm })
          : undefined,
        preparedContent: showContent
          ? prepareChatHtml(message.content, { stripGmContent: !gm })
          : undefined,
        inlineChecks: inlineChecksFromContent(message.content)
      }
    })
  }

  // Comments as the row renders them: author names resolved like every other
  // piece of attribution, and each one marked with whether this user may edit or
  // remove it (their own, or any if they're a GM — see canModifyComment).
  function commentViews(message: ChatMessageData): ChatCommentView[] {
    const selfId = userStore.userId
    const isGM = currentUserIsGM.value
    return readComments(message).map((comment) => ({
      id: comment.id,
      text: comment.text,
      authorName: resolvedUserName(comment.userId),
      mine: !!selfId && comment.userId === selfId,
      canModify: canModifyComment(comment, selfId, isGM)
    }))
  }

  function buildChatMessageView(message: ChatMessageData, index: number): ChatMessageView {
    // Cheap, world/actor-dependent parts — recomputed each pass (they must react
    // to scene/actor/user hydration and actor switches, and are inexpensive).
    const portrait = speakerPortrait(message)
    const author = authorName(message)
    const speaker = speakerName(message, author)
    const isOwnMessage = messageIsFromCurrentUser(message)

    return {
      message,
      key: messageKey(message, index),
      speakerName: speaker,
      authorName: author,
      showAuthorName: !!author && author !== speaker,
      formattedTime: formattedTime(message.timestamp),
      visibilityLabel: visibilityLabel(message),
      whisperRecipients: whisperRecipientNames(message),
      isOwnActor: messageIsOwnActor(message),
      isOwnMessage,
      // Group by the displayed sender identity — the speaker (character alias or
      // OOC player name) plus author — so posting as one character then another,
      // or switching in/out of character, starts a fresh group even for your own
      // messages. (own vs other is enforced separately in sameGroup.)
      senderKey: `${speaker} ${author}`,
      // Filled by the grouping pass in renderedMessages.
      groupStart: true,
      groupEnd: true,
      // Reserve the portrait box from a static signal (the speaker references a
      // token or an actor) so the row keeps a stable height even before
      // scene/actor data has hydrated to resolve the actual src. Without this the
      // box pops in late during rehydration and shifts everything below it.
      hasPortrait: !!message.speaker?.token || !!message.speaker?.actor,
      portrait: portrait.src,
      portraitScale: portrait.scale,
      portraitRing: portrait.ring,
      audioUrl: voiceMemoUrl(message),
      transcript: voiceMemoTranscript(message),
      imageUrl: imageUrl(message),
      imageWidth: message.flags?.tablemate?.imageWidth ?? undefined,
      imageHeight: message.flags?.tablemate?.imageHeight ?? undefined,
      // Reactor names resolve through resolvedUserName so a reaction sent from a
      // sheet-only user reads as the human behind it, like message attribution.
      reactions: groupReactions(readReactions(message), {
        selfUserId: userStore.userId,
        nameFor: resolvedUserName
      }),
      comments: commentViews(message),
      // Expensive HTML parsing — memoized by content fingerprint.
      ...expensiveView(message)
    }
  }

  const renderedMessages = computed(() => {
    const views = messages.value.map(buildChatMessageView)
    // Second pass: group consecutive messages from the same sender so the bubble
    // layout shows the token and the name/time header once, at the top of a run.
    // A run breaks on a different sender, a switch between
    // own/other, a change in visibility (whispers never group with public), or a
    // gap longer than GROUP_GAP_MS.
    for (let i = 0; i < views.length; i++) {
      const view = views[i]
      const prev = views[i - 1]
      const next = views[i + 1]
      view.groupStart = !prev || !sameGroup(prev, view)
      view.groupEnd = !next || !sameGroup(view, next)
    }
    viewMemo.prune(new Set(views.map((v) => v.message._id).filter((id): id is string => !!id)))
    return views
  })

  return {
    messages,
    renderedMessages,
    messageIsOwnActor
  }
}
