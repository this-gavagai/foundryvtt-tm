import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateActor } from '@/types/character-types'
import {
  applyDamage,
  consumeItem,
  rerollChatRoll,
  selectSpellVariant,
  sendImage,
  sendVoiceMemo,
  toggleReaction as toggleReactionRpc
} from '@/api/actionRpc'
import { readReactions, toggleReaction as toggleReactionLocal } from '@/utils/chatReactions'
import { modifyDocument } from '@/api/documents'
import { transcribeAudioOrNull, type TranscriptionConfig } from '@/api/transcription'
import type { DocumentData } from '@/api/internal'
import { useWorldStore } from '@/stores/world'
import { useUserStore } from '@/stores/user'
import { useSettingsStore } from '@/stores/settings'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import {
  withTranscriptContent,
  buildChatMessageCreateData,
  buildSpeaker,
  formatChatContent,
  outOfCharacterAlias,
  type ChatUserLike
} from '@/utils/chatMessage'
import type { ApplyDamageMode, ChatRollRerollMode } from '@/types/api-types'
import { logger, uuidv4 } from '@/utils/utilities'
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

function cardActionKey(message: ChatMessageData): string | undefined {
  return message._id ?? undefined
}

// What the composer is reporting when a send fails: a plain message that didn't
// post, or a chunked media upload that didn't finish. Distinguished because they
// fail for different reasons and read differently to the user — a memo they just
// recorded is still sitting in the composer to retry.
export type ChatSendErrorKind = 'send' | 'upload'

// Send one chunk of a media upload, retrying once if the RPC fails.
//
// A chunked upload is N sequential RPCs, each awaiting its ack before the next
// goes out. Without this, ONE ack lost to a momentary socket gap — or arriving
// after the 30s budget — fails a memo the user has already recorded, and the
// longer the memo the likelier that is. The GM side is idempotent per
// (uploadId, seq) and answers a chunk of an upload that already finished with
// the result it produced, so a re-send either fills the slot that went missing
// or repeats the outcome; it can't post the same memo twice.
async function sendChunkWithRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send()
  } catch (error) {
    logger.warn('TM-WARN: media upload chunk failed; retrying once', error)
    return await send()
  }
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
  // Null when the last send succeeded (or none has run); otherwise which kind of
  // failure to report. Truthy either way, so `if (sendError)` still reads as
  // "the send failed".
  const sendError = ref<ChatSendErrorKind | null>(null)
  const actionError = ref(false)
  const pendingDamageActions = ref(new Set<string>())
  const pendingRollActions = ref(new Set<string>())
  // One in-flight card-button action per message — a card offers at most one
  // meaningful tap at a time (consume it, or pick one of its spell variants).
  const pendingCardMessages = ref(new Set<string>())
  // Keyed `${messageId}:${emoji}` — a chip with an in-flight toggle ignores
  // further taps, so a double-tap can't send two toggles that cancel out.
  const pendingReactions = ref(new Set<string>())

  const worldStore = useWorldStore()
  const userStore = useUserStore()
  const settingsStore = useSettingsStore()
  const versionCompat = useVersionCompatStore()

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

  // Actions carried by buttons inside Foundry's own card HTML that this app
  // knows how to run. Anything else on a card (spell-attack, spell-damage,
  // spell-save, …) is rolled from the character sheet instead, so those buttons
  // are left alone rather than being wired to a half-behavior here.
  const CARD_BUTTON_ACTIONS = ['consume', 'spell-variant'] as const

  // The variant a spell card's button selects. PF2e writes the overlay ids as a
  // comma-separated list; a button with none is the "base variant" button,
  // which reverts the card to the un-overlaid spell — an empty list is a
  // meaningful value here, not a missing one.
  function spellVariantOverlayIds(btn: HTMLButtonElement): string[] {
    return (btn.dataset.overlayIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  }

  // Rank the card was cast at, off the card wrapper PF2e stamps it on. Falls
  // back to 1 exactly as PF2e's own handler does.
  function spellCardCastRank(btn: HTMLButtonElement): number {
    const rank = Number(btn.closest<HTMLElement>('.chat-card')?.dataset.castRank)
    return Number.isInteger(rank) && rank > 0 ? rank : 1
  }

  async function handleCardButtonClick(event: MouseEvent) {
    const selector = CARD_BUTTON_ACTIONS.map((a) => `.card-buttons button[data-action="${a}"]`)
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(selector.join(','))
    if (!btn) return
    event.preventDefault()
    event.stopPropagation()
    triggerLightHapticFeedback()
    const msgEl = btn.closest<HTMLElement>('[data-message-id]')
    const message = messages.value.find((m) => m._id === msgEl?.dataset.messageId)
    if (!message || !messageIsOwnActor(message) || !actor.value) return

    const action = btn.dataset.action
    // Resolve the call BEFORE claiming the pending slot, so a card whose action
    // can't be run (a consume card with no origin item) leaves the button live
    // rather than briefly disabling it for nothing.
    let run: (() => Promise<unknown>) | undefined
    if (action === 'consume') {
      const itemId = originItemId(message)
      if (itemId) run = () => consumeItem(actor, itemId)
    } else if (action === 'spell-variant' && message._id) {
      const messageId = message._id
      const overlayIds = spellVariantOverlayIds(btn)
      const castRank = spellCardCastRank(btn)
      run = () => selectSpellVariant(actor, messageId, overlayIds, castRank)
    }
    if (!run) return

    const key = cardActionKey(message)
    if (!key || setHas(pendingCardMessages, key)) return

    actionError.value = false
    setPending(pendingCardMessages, key, true)
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    try {
      await run()
    } catch {
      actionError.value = true
    } finally {
      setPending(pendingCardMessages, key, false)
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
        operation: { data: [data], render: true }
      },
      (r) => worldStore.applyChatCreate(r.result as DocumentData[])
    )
  }

  // Delete one of the user's own messages directly over the socket. Foundry
  // authorizes an author deleting their own message; the result is echoed to
  // the sender only as the ack (like create), so self-apply it. Throws on a
  // denied/failed write so the caller can surface it.
  async function deleteMessage(messageId: string): Promise<void> {
    await modifyDocument(
      { action: 'delete', type: 'ChatMessage', operation: { ids: [messageId] } },
      (r) => worldStore.applyChatDelete(r.result as string[])
    )
  }

  // Edit the text of one of the user's own messages. Content is shaped exactly
  // like a fresh post (escaped, newlines → <br>) and self-applied from the ack.
  async function updateMessageContent(messageId: string, content: string): Promise<void> {
    await modifyDocument(
      {
        action: 'update',
        type: 'ChatMessage',
        operation: {
          updates: [{ _id: messageId, content: formatChatContent(content) }],
          render: true
        }
      },
      (r) => worldStore.applyChatUpdate(r.result as DocumentData[])
    )
  }

  // Toggle this user's emoji reaction on a message.
  //
  // Unlike send/edit/delete above, this can't be a direct socket write: Foundry
  // only lets a message's author (or a GM) update it, and a reaction is a write
  // to someone else's message. So it goes through the GM client as an RPC, which
  // means it needs a GM online and takes a round-trip — hence the optimistic
  // apply, so the chip responds to the tap immediately.
  //
  // Three-step: guess locally, send, then write back whatever the GM actually
  // stored. That last step is not just rollback-on-error — it also settles a
  // genuine race, since another player may have reacted between our read and the
  // GM's write, and the authoritative list is what came back.
  async function toggleMessageReaction(message: ChatMessageData, emoji: string): Promise<void> {
    const messageId = message._id
    const userId = userStore.userId
    if (!messageId || !userId) return

    const key = `${messageId}:${emoji}`
    if (setHas(pendingReactions, key)) return

    const before = readReactions(message)
    const optimistic = toggleReactionLocal(before, emoji, userId)

    actionError.value = false
    setPending(pendingReactions, key, true)
    worldStore.applyChatReactions(messageId, optimistic)
    try {
      const ack = await toggleReactionRpc(messageId, emoji)
      worldStore.applyChatReactions(messageId, ack.reactions)
    } catch {
      // Put the pre-tap list back — no GM online, an error ack, or a timeout.
      worldStore.applyChatReactions(messageId, before)
      actionError.value = true
    } finally {
      setPending(pendingReactions, key, false)
    }
  }

  function isReactionPending(messageId: string | null | undefined, emoji: string): boolean {
    return !!messageId && setHas(pendingReactions, `${messageId}:${emoji}`)
  }

  async function submitMessage(
    contentOverride?: string,
    options?: { outOfCharacter?: boolean; whisperIds?: string[]; whisperIntended?: boolean }
  ) {
    const content = (contentOverride ?? draft.value).trim()
    if (!content || !actorId.value || isSending.value) return

    isSending.value = true
    sendError.value = null
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
      sendError.value = 'send'
      // Restore the failed message so it isn't lost, unless the user has
      // already started typing a replacement.
      if (!draft.value) draft.value = previousDraft
    } finally {
      isSending.value = false
    }
  }

  // ── Voice memo transcription ───────────────────────────────────────────────
  // Transcription of the take sitting in the composer, started as soon as the
  // recording finished rather than on send: the user then spends a few seconds
  // reviewing the take and typing a caption, which is time the transcription
  // gets for free, so the text is usually already in hand when they hit send.
  //
  // The transcription belonging to that take: still out, or settled on a text —
  // which the user may have corrected, or cleared to drop the transcript
  // altogether. Keyed by the blob so a result can never be attached to a
  // different take.
  type MemoTranscription =
    | { blob: Blob; running: true; text: Promise<string | null> }
    | { blob: Blob; running: false; text: string | null }
  let memoTranscription: MemoTranscription | null = null

  // What the composer shows beneath the take it is previewing: the transcript
  // once it lands, and whether one is still on its way. Both are cleared when
  // the take is discarded or replaced. A failed transcription reads as neither
  // — nothing is shown, and the memo simply posts without text.
  const voiceMemoTranscript = ref<string | null>(null)
  const voiceMemoTranscribing = ref(false)

  // What this device can transcribe with right now, or null when it doesn't.
  // Also null against a module too old to name the message it posted a memo as,
  // since the text would then have nowhere to go — not worth a billable call.
  function memoTranscriptionConfig(): TranscriptionConfig | null {
    if (!versionCompat.supportsVoiceMemoTranscript) return null
    return settingsStore.transcriptionConfig
  }

  // Start transcribing a finished recording. Called by the composer the moment
  // the recorder produces its blob; a no-op on a device that doesn't transcribe,
  // and idempotent for a take already under way.
  //
  // The cost of starting here rather than on send is a discarded take's
  // transcription, which is paid for and thrown away. That is the trade for
  // having the text ready when the memo posts.
  function beginVoiceMemoTranscription(blob: Blob, mimeType: string): void {
    const config = memoTranscriptionConfig()
    if (!config) {
      discardVoiceMemoTranscription()
      return
    }
    if (memoTranscription?.blob === blob) return
    const started: MemoTranscription = {
      blob,
      running: true,
      text: transcribeAudioOrNull(blob, mimeType, config)
    }
    memoTranscription = started
    voiceMemoTranscript.value = null
    voiceMemoTranscribing.value = true
    void started.text.then((text) => {
      // Ignore a result the composer has moved on from — a retake, a discard, or
      // a correction typed while the call was still out. None of those texts
      // belong under the take now on screen.
      if (memoTranscription !== started) return
      memoTranscription = { blob, running: false, text }
      voiceMemoTranscript.value = text
      voiceMemoTranscribing.value = false
    })
  }

  // Replace the transcript with the user's correction of it — the composer lets
  // them tap the text and fix a misheard name before the memo goes out. An empty
  // correction means "no transcript": the memo posts audio-only, which is also
  // how a transcription the user doesn't want sent gets deleted.
  function setVoiceMemoTranscript(text: string): void {
    const corrected = text.trim() || null
    voiceMemoTranscript.value = corrected
    voiceMemoTranscribing.value = false
    // Settling the entry also detaches an in-flight call (begin's handler checks
    // identity), so a slow transcription can't land on top of the correction.
    if (memoTranscription) {
      memoTranscription = { blob: memoTranscription.blob, running: false, text: corrected }
    }
  }

  // Forget the transcription — the take was discarded or re-recorded, so its text
  // belongs to nothing now. Any in-flight request is left to resolve into the
  // void; it is already paid for, and nothing waits on it.
  function discardVoiceMemoTranscription(): void {
    memoTranscription = null
    voiceMemoTranscript.value = null
    voiceMemoTranscribing.value = false
  }

  // The transcription to attach to the memo now being sent.
  //
  // Text the user can see under the take is what gets sent — including their
  // correction of it, and including the empty result of deleting it. A call
  // still in flight has shown them nothing to judge, so it is subject to the
  // transcription setting as it stands now. A take that never went through
  // beginVoiceMemoTranscription still transcribes, just from here.
  //
  // The entry is deliberately left in place: a send that fails keeps the take for
  // a retry, and that retry should reuse this call rather than pay for a second
  // one. It is cleared when the take itself goes away.
  function takeVoiceMemoTranscription(blob: Blob, mimeType: string): Promise<string | null> | null {
    const current = memoTranscription
    if (current?.blob === blob) {
      if (!current.running) return current.text === null ? null : Promise.resolve(current.text)
      return memoTranscriptionConfig() ? current.text : null
    }
    const config = memoTranscriptionConfig()
    if (!config) return null
    return transcribeAudioOrNull(blob, mimeType, config)
  }

  // Send a recorded voice memo: slice the blob into base64 chunks and stream
  // them to the GM client, which reassembles + uploads + posts the message.
  // Awaits each chunk's ack before the next (ordering + backpressure); shares
  // the text composer's isSending/sendError so the UI reflects it uniformly.
  //
  // The transcription is never awaited here — it has usually been running since
  // the recording stopped, and whenever it lands it is patched onto the posted
  // message. The memo posts at upload speed either way.
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
    const characterId = actorId.value
    if (!characterId || isSending.value) return
    if (blob.size === 0) {
      sendError.value = 'upload'
      return
    }
    isSending.value = true
    sendError.value = null
    const pendingTranscript = takeVoiceMemoTranscription(blob, meta.mimeType)
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const chunks = sliceBytesToBase64Chunks(bytes)
      const uploadId = uuidv4()
      let posted: { messageId?: string; content?: string } | undefined
      for (let seq = 0; seq < chunks.length; seq++) {
        posted = await sendChunkWithRetry(() =>
          sendVoiceMemo(
            characterId,
            { uploadId, seq, total: chunks.length, chunkBase64: chunks[seq] },
            { ...meta, transcriptPending: !!pendingTranscript }
          )
        )
      }
      // Detached: the composer is done once the memo is posted.
      if (pendingTranscript) void attachVoiceMemoTranscript(posted, pendingTranscript)
      onMessageSent?.()
    } catch {
      sendError.value = 'upload'
    } finally {
      isSending.value = false
    }
  }

  // Write a memo's transcript to its posted message: the flag the app renders
  // from, and the content copy Foundry's own chat log renders from. `content` is
  // the message as it stands; the transcript replaces whatever was in its
  // wrapper, leaving the caption and the <audio> element alone.
  //
  // A direct socket write, not an RPC — we authored the message, and Foundry
  // authorizes an author updating their own. Foundry deep-merges the update, so
  // writing flags.tablemate.transcript leaves audioPath/mime/duration intact
  // (the local self-apply has to do that merge by hand; see applyChatTranscript).
  async function writeVoiceMemoTranscript(
    messageId: string,
    content: string,
    transcript: string
  ): Promise<void> {
    const updated = withTranscriptContent(content, transcript)
    await modifyDocument(
      {
        action: 'update',
        type: 'ChatMessage',
        operation: {
          updates: [{ _id: messageId, content: updated, flags: { tablemate: { transcript } } }],
          render: true
        }
      },
      () => worldStore.applyChatTranscript(messageId, updated, transcript)
    )
  }

  // Patch a finished transcription onto the memo it belongs to, once the upload
  // has come back with the message it posted as.
  //
  // Best-effort throughout: a failed transcription, an ack that named no message
  // (a module too old to report one), or a rejected update all leave the memo
  // audio-only, which is exactly what an unconfigured device gets.
  async function attachVoiceMemoTranscript(
    posted: { messageId?: string; content?: string } | undefined,
    pendingTranscript: Promise<string | null>
  ): Promise<void> {
    const transcript = await pendingTranscript
    if (!transcript) return
    const messageId = posted?.messageId
    if (!messageId) {
      logger.warn('TM-WARN: voice memo transcript dropped — no message id in the ack')
      return
    }
    try {
      await writeVoiceMemoTranscript(messageId, posted?.content ?? '', transcript)
    } catch (error) {
      logger.warn('TM-WARN: voice memo transcript update failed', error)
    }
  }

  // Correct the transcript of a memo already in the log — the same edit
  // affordance a text message has, except that what is being edited is the
  // transcript rather than the message body, so the recording itself survives.
  // Throws on a rejected write, like updateMessageContent, so the composer can
  // surface the failure instead of pretending the edit stuck.
  async function updateVoiceMemoTranscript(
    messageId: string,
    content: string,
    transcript: string
  ): Promise<void> {
    await writeVoiceMemoTranscript(messageId, content, transcript)
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
    const characterId = actorId.value
    if (!characterId || isSending.value) return
    if (image.bytes.length === 0) {
      sendError.value = 'upload'
      return
    }
    isSending.value = true
    sendError.value = null
    try {
      const chunks = sliceBytesToBase64Chunks(image.bytes)
      const uploadId = uuidv4()
      for (let seq = 0; seq < chunks.length; seq++) {
        await sendChunkWithRetry(() =>
          sendImage(
            characterId,
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
        )
      }
      onMessageSent?.()
    } catch {
      sendError.value = 'upload'
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
    beginVoiceMemoTranscription,
    discardVoiceMemoTranscription,
    setVoiceMemoTranscript,
    voiceMemoTranscript,
    voiceMemoTranscribing,
    submitImage,
    deleteMessage,
    updateMessageContent,
    updateVoiceMemoTranscript,
    toggleMessageReaction,
    isReactionPending,
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
