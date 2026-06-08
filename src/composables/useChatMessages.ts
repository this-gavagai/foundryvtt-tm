import { computed, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { getPath } from '@/utils/utilities'
import { prepareChatHtml } from '@/utils/chatHtml'
import {
  rollSummaries,
  type ChatRollSummary,
  type RollJson
} from '@/utils/chatRollSummary'

type CollectionLike<T> =
  | T[]
  | {
      contents?: T[]
      values?: () => IterableIterator<T>
    }
  | undefined

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
    pf2e?: {
      origin?: { uuid?: string | null }
    }
  }
}

interface UserData {
  _id?: string | null
  id?: string | null
  name?: string | null
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

export interface ChatMessageView {
  message: ChatMessageData
  key: string
  speakerName: string
  authorName: string
  showAuthorName: boolean
  formattedTime: string
  visibilityLabel: string | null
  isOwnActor: boolean
  portrait?: string
  portraitScale: { '--sx': number; '--sy': number }
  preparedFlavor?: string
  preparedContent?: string
  showContent: boolean
  showEmptyMessage: boolean
  rolls: ChatRollSummary[]
}

function collectionToArray<T>(source: CollectionLike<T>): T[] {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  return []
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

function shouldShowMessageContent(
  message: ChatMessageData,
  summaries = rollSummaries(message.rolls)
): boolean {
  if (!message.content) return false
  if (!summaries.length) return true
  const contentText = plainChatText(message.content)
  return !summaries.some((roll) => roll.total !== undefined && contentText === String(roll.total))
}

export function useChatMessages(currentActorId: Ref<string | null | undefined>) {
  const { world } = storeToRefs(useWorldStore())

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

  const messages = computed(() =>
    collectionToArray<ChatMessageData>(world.value?.messages as CollectionLike<ChatMessageData>)
      .slice()
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  )

  function authorName(message: ChatMessageData): string {
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

  function speakerToken(message: ChatMessageData): ChatTokenData | undefined {
    const speaker = message.speaker
    if (!speaker?.token) return undefined
    const scene =
      scenes.value.find((s) => s._id === speaker.scene) ?? scenes.value.find((s) => s.active)
    return collectionToArray(scene?.tokens).find((token) => token._id === speaker.token)
  }

  function tokenPortrait(token: ChatTokenData | undefined): string | undefined {
    const src = token?.texture?.src
    return src ? getPath(src) : undefined
  }

  function tokenScale(token: ChatTokenData | undefined): { '--sx': number; '--sy': number } {
    const texture = token?.texture
    return {
      '--sx': texture?.scaleX ?? 1,
      '--sy': texture?.scaleY ?? 1
    }
  }

  function buildChatMessageView(message: ChatMessageData, index: number): ChatMessageView {
    const rolls = rollSummaries(message.rolls)
    const showContent = shouldShowMessageContent(message, rolls)
    const token = speakerToken(message)
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
      isOwnActor: messageIsOwnActor(message),
      portrait: tokenPortrait(token),
      portraitScale: tokenScale(token),
      preparedFlavor: message.flavor ? prepareChatHtml(message.flavor) : undefined,
      preparedContent: showContent ? prepareChatHtml(message.content) : undefined,
      showContent,
      showEmptyMessage: !showContent && !rolls.length,
      rolls
    }
  }

  const renderedMessages = computed(() => messages.value.map(buildChatMessageView))

  return {
    messages,
    renderedMessages,
    messageIsOwnActor
  }
}
