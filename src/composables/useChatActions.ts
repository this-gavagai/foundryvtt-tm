import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateActor } from '@/types/character-types'
import {
  applyDamage,
  consumeItem,
  rerollChatRoll,
  sendImage,
  sendVoiceMemo
} from '@/api/actionRpc'
import { modifyDocument } from '@/api/documents'
import type { DocumentData } from '@/api/internal'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import {
  buildChatMessageCreateData,
  buildSpeaker,
  formatChatContent,
  outOfCharacterAlias,
  type ChatUserLike
} from '@/utils/chatMessage'
import type { ApplyDamageMode, ChatRollRerollMode } from '@/types/api-types'
import { uuidv4 } from '@/utils/utilities'
import { sliceBytesToBase64Chunks } from '@/utils/voiceMemoChunks'
import type { PreparedImage } from '@/utils/imageUpload'
import type { ChatRollSummary } from '@/utils/chatRollSummary'
import { messageIsReroll, originItemId, type ChatMessageData } from '@/composables/useChatMessages'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

// The full action surface, passed down to ChatMessageRow/ChatRollCard as a
// single prop so the pending-set state stays owned by the overlay's instance.
export type ChatActions = ReturnType<typeof useChatActions>

// Everything needed to launch (and later execute) a reroll: assembled by the
// roll card that owns the context, consumed by the overlay's reroll modal.
export interface ChatRerollRequest {
  message: ChatMessageData
  roll: ChatRollSummary
  rollIndex: number
  mode: ChatRollRerollMode
}

interface ShieldState {
  itemId: Ref<string | null | undefined>
  hp: {
    current: Ref<number | null | undefined>
  }
  hardness: Ref<number | null | undefined>
}

function setHas(setRef: Ref<Set<string>>, key: string): boolean {
  return setRef.value.has(key)
}

function setPending(setRef: Ref<Set<string>>, key: string, pending: boolean) {
  const next = new Set(setRef.value)
  if (pending) next.add(key)
  else next.delete(key)
  setRef.value = next
}

function damageActionKey(message: ChatMessageData, rollIndex: number): string | undefined {
  if (!message._id) return undefined
  return `${message._id}:${rollIndex}`
}

function rollActionKey(message: ChatMessageData, rollIndex: number): string | undefined {
  if (!message._id) return undefined
  return `${message._id}:${rollIndex}`
}

function consumeActionKey(message: ChatMessageData): string | undefined {
  return message._id ?? undefined
}

export function useChatActions({
  actorId,
  actor,
  shield,
  messages,
  messageIsOwnActor,
  onMessageSent
}: {
  actorId: Ref<string | null | undefined>
  actor: Ref<TablemateActor | null | undefined>
  // Characters only — familiars have no shield, so shield-block actions are
  // simply unavailable on their sheets.
  shield?: ShieldState
  messages: ComputedRef<ChatMessageData[]>
  messageIsOwnActor: (message: ChatMessageData) => boolean
  onMessageSent?: () => void
}) {
  const draft = ref('')
  const isSending = ref(false)
  const sendError = ref(false)
  const actionError = ref(false)
  const pendingDamageActions = ref(new Set<string>())
  const pendingRollActions = ref(new Set<string>())
  const pendingConsumeMessages = ref(new Set<string>())

  const worldStore = useWorldStore()
  const userStore = useUserStore()

  const canSend = computed(
    () => !!actorId.value && draft.value.trim().length > 0 && !isSending.value
  )

  function canApplyDamage(roll: ChatRollSummary): boolean {
    return roll.className === 'DamageRoll' && roll.total !== undefined && !!actor.value
  }

  function canReroll(message: ChatMessageData, roll: ChatRollSummary): boolean {
    return (
      roll.className === 'CheckRoll' &&
      !!actor.value &&
      messageIsOwnActor(message) &&
      message.isRerollable !== false &&
      !messageIsReroll(message)
    )
  }

  function canShieldBlock(): boolean {
    return (
      !!shield?.itemId.value &&
      (shield?.hp.current.value ?? 0) > 0 &&
      (shield?.hardness.value ?? 0) > 0
    )
  }

  function isDamageActionPending(message: ChatMessageData, rollIndex: number): boolean {
    const key = damageActionKey(message, rollIndex)
    return !!key && setHas(pendingDamageActions, key)
  }

  function isRollActionPending(message: ChatMessageData, rollIndex: number): boolean {
    const key = rollActionKey(message, rollIndex)
    return !!key && setHas(pendingRollActions, key)
  }

  function canTriggerDamageAction(
    message: ChatMessageData,
    roll: ChatRollSummary,
    rollIndex: number,
    mode: ApplyDamageMode
  ): boolean {
    if (!canApplyDamage(roll)) return false
    if (mode === 'block' && !canShieldBlock()) return false
    const key = damageActionKey(message, rollIndex)
    return !!key && !setHas(pendingDamageActions, key)
  }

  function canTriggerRollAction(
    message: ChatMessageData,
    roll: ChatRollSummary,
    rollIndex: number,
    mode: ChatRollRerollMode
  ): boolean {
    if (!canReroll(message, roll)) return false
    // Hero points are a character resource; familiars resolve to 0 and can't
    // hero-point reroll.
    if (
      mode === 'hero-point' &&
      ((actor.value as CharacterPF2e | undefined)?.system?.resources?.heroPoints?.value ?? 0) <= 0
    ) {
      return false
    }
    const key = rollActionKey(message, rollIndex)
    return !!key && !setHas(pendingRollActions, key)
  }

  async function applyDamageRoll(
    message: ChatMessageData,
    roll: ChatRollSummary,
    rollIndex: number,
    mode: ApplyDamageMode
  ) {
    if (!canTriggerDamageAction(message, roll, rollIndex, mode)) return
    const key = damageActionKey(message, rollIndex)
    if (!key || !message._id || !actor.value) return

    actionError.value = false
    setPending(pendingDamageActions, key, true)
    try {
      await applyDamage(actor, message._id, mode, rollIndex)
    } catch {
      actionError.value = true
    } finally {
      setPending(pendingDamageActions, key, false)
    }
  }

  async function rerollRoll(
    message: ChatMessageData,
    roll: ChatRollSummary,
    rollIndex: number,
    mode: ChatRollRerollMode,
    faces?: number[]
  ) {
    if (!canTriggerRollAction(message, roll, rollIndex, mode)) return
    const key = rollActionKey(message, rollIndex)
    if (!key || !message._id || !actor.value) return

    actionError.value = false
    setPending(pendingRollActions, key, true)
    try {
      return await rerollChatRoll(
        actor,
        message._id,
        mode,
        rollIndex,
        faces?.[0] != null ? { d20: [faces[0]] } : {}
      )
    } catch {
      actionError.value = true
      return null
    } finally {
      setPending(pendingRollActions, key, false)
    }
  }

  async function handleCardButtonClick(event: MouseEvent) {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '.card-buttons button[data-action="consume"]'
    )
    if (!btn) return
    event.preventDefault()
    event.stopPropagation()
    triggerLightHapticFeedback()
    const msgEl = btn.closest<HTMLElement>('[data-message-id]')
    const message = messages.value.find((m) => m._id === msgEl?.dataset.messageId)
    if (!message || !messageIsOwnActor(message) || !actor.value) return
    const itemId = originItemId(message)
    if (!itemId) return
    const key = consumeActionKey(message)
    if (!key || setHas(pendingConsumeMessages, key)) return

    actionError.value = false
    setPending(pendingConsumeMessages, key, true)
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    try {
      await consumeItem(actor, itemId)
    } catch {
      actionError.value = true
    } finally {
      setPending(pendingConsumeMessages, key, false)
      btn.disabled = false
      btn.removeAttribute('aria-busy')
    }
  }

  // Resolve the active scene + this actor's placed token on it, for a faithful
  // speaker (per-token portrait art). Both are best-effort — the read side
  // falls back to the actor's own portrait when the token can't be resolved, so
  // a world payload without scene tokens still posts a valid message.
  interface SceneLike {
    _id?: string | null
    active?: boolean
    tokens?: unknown
  }
  interface TokenLike {
    _id?: string | null
    actorId?: string | null
  }
  function resolveSpeakerContext(actorIdValue: string): {
    sceneId?: string
    tokenId?: string
  } {
    const scenes = collectionToArray<SceneLike>(
      (worldStore.world as { scenes?: unknown } | undefined)?.scenes as CollectionLike<SceneLike>
    )
    const active = scenes.find((scene) => scene.active)
    if (!active) return {}
    const tokenId = collectionToArray<TokenLike>(active.tokens as CollectionLike<TokenLike>).find(
      (token) => token.actorId === actorIdValue
    )?._id
    return { sceneId: active._id ?? undefined, tokenId: tokenId ?? undefined }
  }

  // Post a chat message DIRECTLY over the modifyDocument socket, as this app's
  // own Foundry user, rather than asking the GM proxy to run ChatMessage.create
  // (the old SEND_CHAT_MESSAGE RPC). Works with no GM client online and skips
  // the proxy's serialized dispatch, at the cost of building the speaker /
  // whisper / OOC-alias shaping client-side (see utils/chatMessage.ts). The
  // created message is echoed to the sender only as the emit ack, so we
  // self-apply it into world.messages (worldStore.applyChatCreate).
  async function postChatMessageDirect(
    content: string,
    options: { outOfCharacter: boolean; whisperIds: string[]; whisperIntended: boolean }
  ): Promise<void> {
    const actorIdValue = actorId.value
    const userId = userStore.userId
    if (!actorIdValue || !userId) throw new Error('Cannot send chat: actor or user not ready')

    const users = collectionToArray<ChatUserLike>(
      (worldStore.world as { users?: unknown } | undefined)?.users as CollectionLike<ChatUserLike>
    )
    const oocAlias = options.outOfCharacter ? outOfCharacterAlias(users, userId) : undefined
    const { sceneId, tokenId } = resolveSpeakerContext(actorIdValue)
    const speaker = buildSpeaker({
      outOfCharacter: options.outOfCharacter,
      actorId: actorIdValue,
      actorName: actor.value?.name ?? undefined,
      sceneId,
      tokenId,
      oocAlias
    })

    // Leak-guard: a message aimed at recipients that all resolve away (e.g. the
    // only selected user left the world) is scoped to the author rather than
    // posted publicly — mirrors foundrySendChatMessage's empty-whisper handling.
    const whisperIds =
      options.whisperIntended && options.whisperIds.length === 0 ? [userId] : options.whisperIds

    const data = buildChatMessageCreateData({
      userId,
      speaker,
      content: formatChatContent(content),
      whisperIds
    })

    await modifyDocument(
      {
        action: 'create',
        type: 'ChatMessage',
        operation: { data: [data as unknown as Record<string, unknown>], render: true }
      },
      (r) => worldStore.applyChatCreate(r.result as DocumentData[])
    )
  }

  async function submitMessage(
    contentOverride?: string,
    options?: { outOfCharacter?: boolean; whisperIds?: string[]; whisperIntended?: boolean }
  ) {
    const content = (contentOverride ?? draft.value).trim()
    if (!content || !actorId.value || isSending.value) return

    isSending.value = true
    sendError.value = false
    // Clear the draft up front so the composer empties immediately and the
    // textarea (which stays enabled during send to keep the iOS keyboard up)
    // never clobbers anything the user types while the request is in flight.
    const previousDraft = draft.value
    draft.value = ''
    try {
      await postChatMessageDirect(content, {
        outOfCharacter: options?.outOfCharacter ?? false,
        whisperIds: options?.whisperIds ?? [],
        whisperIntended: options?.whisperIntended ?? false
      })
      onMessageSent?.()
    } catch {
      sendError.value = true
      // Restore the failed message so it isn't lost, unless the user has
      // already started typing a replacement.
      if (!draft.value) draft.value = previousDraft
    } finally {
      isSending.value = false
    }
  }

  // Send a recorded voice memo: slice the blob into base64 chunks and stream
  // them to the GM client, which reassembles + uploads + posts the message.
  // Awaits each chunk's ack before the next (ordering + backpressure); shares
  // the text composer's isSending/sendError so the UI reflects it uniformly.
  async function submitVoiceMemo(
    blob: Blob,
    meta: {
      mimeType: string
      durationMs: number
      content?: string
      outOfCharacter?: boolean
      whisper?: string[]
    }
  ) {
    if (!actorId.value || isSending.value) return
    if (blob.size === 0) {
      sendError.value = true
      return
    }
    isSending.value = true
    sendError.value = false
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const chunks = sliceBytesToBase64Chunks(bytes)
      const uploadId = uuidv4()
      for (let seq = 0; seq < chunks.length; seq++) {
        await sendVoiceMemo(
          actorId.value,
          { uploadId, seq, total: chunks.length, chunkBase64: chunks[seq] },
          meta
        )
      }
      onMessageSent?.()
    } catch {
      sendError.value = true
    } finally {
      isSending.value = false
    }
  }

  // Send a prepared image: slice the bytes into base64 chunks and stream them to
  // the GM client, which reassembles + uploads + posts the message. The image
  // twin of submitVoiceMemo — same chunking, same shared isSending/sendError.
  async function submitImage(
    image: PreparedImage,
    meta: {
      content?: string
      outOfCharacter?: boolean
      whisper?: string[]
    } = {}
  ) {
    if (!actorId.value || isSending.value) return
    if (image.bytes.length === 0) {
      sendError.value = true
      return
    }
    isSending.value = true
    sendError.value = false
    try {
      const chunks = sliceBytesToBase64Chunks(image.bytes)
      const uploadId = uuidv4()
      for (let seq = 0; seq < chunks.length; seq++) {
        await sendImage(
          actorId.value,
          { uploadId, seq, total: chunks.length, chunkBase64: chunks[seq] },
          {
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
            content: meta.content,
            outOfCharacter: meta.outOfCharacter,
            whisper: meta.whisper
          }
        )
      }
      onMessageSent?.()
    } catch {
      sendError.value = true
    } finally {
      isSending.value = false
    }
  }

  return {
    draft,
    isSending,
    sendError,
    actionError,
    canSend,
    submitVoiceMemo,
    submitImage,
    canApplyDamage,
    canReroll,
    isDamageActionPending,
    isRollActionPending,
    canTriggerDamageAction,
    canTriggerRollAction,
    applyDamageRoll,
    rerollRoll,
    handleCardButtonClick,
    submitMessage
  }
}
