import { computed, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { debounce } from 'lodash-es'
import { useWorldStore } from '@/stores/world'
import { useUserStore, lastKnownUserId } from '@/stores/user'
import { loadCachedChatMessages, saveCachedChatMessages } from '@/utils/chatCache'
import { getPath } from '@/utils/utilities'
import { prepareChatHtml } from '@/utils/chatHtml'
import { rollSummaries, type ChatRollSummary, type RollJson } from '@/utils/chatRollSummary'
import { applyPf2eNotation } from '@/utils/pf2eEnrich'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import { useChatVisibility, type UserData } from '@/composables/useChatVisibility'
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
    }
    pf2e?: {
      origin?: { uuid?: string | null }
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

interface ChatTokenData {
  _id?: string | null
  actorId?: string | null
  texture?: {
    src?: string | null
    scaleX?: number | null
    scaleY?: number | null
  }
}

interface ChatSceneData {
  _id?: string | null
  active?: boolean
  tokens?: CollectionLike<ChatTokenData>
}

interface ChatActorData {
  _id?: string | null
  img?: string | null
  prototypeToken?: {
    texture?: {
      src?: string | null
      scaleX?: number | null
      scaleY?: number | null
    }
  }
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
  hasPortrait: boolean
  portrait?: string
  portraitScale: { '--sx': number; '--sy': number }
  preparedFlavor?: string
  preparedContent?: string
  showContent: boolean
  showEmptyMessage: boolean
  rerollSummary?: ChatRerollSummary
  rolls: ChatRollSummary[]
  inlineChecks: ActiveRoll[]
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

function plainChatText(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
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
  const { currentUserIsGM, messageVisibleToCurrentUser, visibleMessages } = useChatVisibility()

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
  const scenes = computed(() =>
    collectionToArray<ChatSceneData>(world.value?.scenes as CollectionLike<ChatSceneData>)
  )

  const actorsById = computed(() => {
    const map = new Map<string, ChatActorData>()
    collectionToArray<ChatActorData>(
      world.value?.actors as CollectionLike<ChatActorData>
    ).forEach((actor) => {
      if (actor._id) map.set(actor._id, actor)
    })
    return map
  })

  // Stale-while-revalidate: hydrate the last-seen messages from IndexedDB so the
  // overlay isn't empty on a cold launch, then fall through to live data the
  // moment the world payload arrives. Keyed by the Foundry user _id, falling
  // back to the last-known persisted id so the read resolves before the session
  // handshake has repopulated the user store. Save and load MUST use the same
  // key — `userId` (the Foundry _id) is distinct from the login username.
  const userStore = useUserStore()
  const cacheKey = () => userStore.userId || lastKnownUserId()
  const cachedMessages = ref<ChatMessageData[]>([])
  void loadCachedChatMessages(cacheKey()).then((cached) => {
    if (cached?.length) cachedMessages.value = cached
  })

  const messages = computed(() => {
    // Once the world payload has arrived it is canonical — show it verbatim
    // (via the shared visibleMessages), even when empty (e.g. messages were
    // deleted). Falling back to the cache whenever `live` is merely empty would
    // resurrect deleted messages, so the cache is only a pre-world placeholder,
    // gated on `world.value` presence.
    if (world.value) return visibleMessages.value
    return cachedMessages.value
      .filter(messageVisibleToCurrentUser)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  })

  // Persist the live messages (debounced) so the next cold launch has them.
  // Watch a content fingerprint (count + last id/timestamp) rather than the
  // array itself: in-place mutation keeps the same reference, so a plain
  // array watch would miss appends. Only writes live data, never the cached
  // fallback back onto itself.
  const persist = debounce((userId: string, msgs: ChatMessageData[]) => {
    void saveCachedChatMessages(userId, msgs)
  }, 1000)
  // Raw (server-filtered) live messages for the cache write — kept verbatim so a
  // cold relaunch restores the same tail Foundry sent. Plain function, not a
  // computed: in-place appends + triggerRef(world) keep the array reference
  // stable, which a value-comparing computed would memoize past.
  const liveMessages = () =>
    collectionToArray<ChatMessageData>(world.value?.messages as CollectionLike<ChatMessageData>)
  watch(
    () => {
      const live = liveMessages()
      if (!live.length) return ''
      const last = live[live.length - 1]
      return `${live.length}:${last?._id ?? ''}:${last?.timestamp ?? ''}`
    },
    (fingerprint) => {
      if (!fingerprint) return
      const userId = cacheKey()
      if (userId) persist(userId, liveMessages())
    }
  )

  function authorName(message: ChatMessageData): string {
    const tablemateOrigin = tablemateOriginUserId(message)
    if (tablemateOrigin) return userNamesById.value.get(tablemateOrigin) ?? tablemateOrigin

    if (typeof message.author === 'object' && message.author?.name) return message.author.name
    const authorId = typeof message.author === 'string' ? message.author : (message.user ?? '')
    return userNamesById.value.get(authorId) ?? authorId
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
  // art and scale) and falling back to the actor's own portrait. Messages whose
  // speaker carries only an actor — plain chat sent via ChatMessage.getSpeaker,
  // or any actor without a token in the active scene — have no scene token, so
  // without this fallback they render with no portrait at all.
  function speakerPortrait(message: ChatMessageData): {
    src?: string
    scale: { '--sx': number; '--sy': number }
  } {
    const token = speakerToken(message)
    if (token?.texture?.src) {
      return {
        src: getPath(token.texture.src),
        scale: { '--sx': token.texture.scaleX ?? 1, '--sy': token.texture.scaleY ?? 1 }
      }
    }
    const actorId = message.speaker?.actor
    const actor = actorId ? actorsById.value.get(actorId) : undefined
    const proto = actor?.prototypeToken?.texture
    const src = proto?.src ?? actor?.img ?? undefined
    return {
      src: src ? getPath(src) : undefined,
      scale: { '--sx': proto?.scaleX ?? 1, '--sy': proto?.scaleY ?? 1 }
    }
  }

  function buildChatMessageView(message: ChatMessageData, index: number): ChatMessageView {
    const rolls = rollSummaries(message.rolls)
    const rerollSummary = parseRerollSummary(message.content)
    const showContent = shouldShowMessageContent(message, rolls, rerollSummary)
    const portrait = speakerPortrait(message)
    const author = authorName(message)
    const speaker = speakerName(message, author)
    const visibility = visibilityLabel(message)

    return {
      message,
      key: messageKey(message, index),
      speakerName: speaker,
      authorName: author,
      showAuthorName: !!author && author !== speaker,
      formattedTime: formattedTime(message.timestamp),
      visibilityLabel: visibility,
      whisperRecipients: whisperRecipientNames(message),
      isOwnActor: messageIsOwnActor(message),
      // Reserve the portrait box from a static signal (the speaker references a
      // token or an actor) so the row keeps a stable height even before
      // scene/actor data has hydrated to resolve the actual src. Without this the
      // box pops in late during rehydration and shifts everything below it.
      hasPortrait: !!message.speaker?.token || !!message.speaker?.actor,
      portrait: portrait.src,
      portraitScale: portrait.scale,
      preparedFlavor: message.flavor
        ? prepareChatHtml(message.flavor, { stripGmContent: !currentUserIsGM.value })
        : undefined,
      preparedContent: showContent
        ? prepareChatHtml(message.content, { stripGmContent: !currentUserIsGM.value })
        : undefined,
      showContent,
      showEmptyMessage: !showContent && !rolls.length,
      rerollSummary,
      rolls,
      inlineChecks: inlineChecksFromContent(message.content)
    }
  }

  const renderedMessages = computed(() => messages.value.map(buildChatMessageView))

  return {
    messages,
    renderedMessages,
    messageIsOwnActor
  }
}
