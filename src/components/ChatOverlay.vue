<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'
import {
  MicrophoneIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  StopIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/vue/24/outline'
import { useInjectedActor } from '@/composables/injectKeys'
import { useOverlayStack } from '@/composables/useOverlayStack'
import { useAudioRecorder, audioRecordingSupported } from '@/composables/useAudioRecorder'
import { useImageAttachment } from '@/composables/useImageAttachment'
import { imageFileFromTransfer, imageUploadSupported } from '@/utils/imageUpload'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import { useChatStore } from '@/stores/chat'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useListenersStore } from '@/stores/listenersOnline'
import { useChatActions, type ChatRerollRequest } from '@/composables/useChatActions'
import {
  useChatMessages,
  chatContentToEditableText,
  type ChatMessageView
} from '@/composables/useChatMessages'
import { useChatScroll } from '@/composables/useChatScroll'
import { PUBLIC_WHISPER_TARGET, useWhisperTargets } from '@/composables/useWhisperTargets'
import { rerollLabelKey, rollFormulaLabel, rollKindLabel } from '@/utils/chatRollDisplay'
import {
  activeRollFromFoundryClickTarget,
  compendiumItemUuidFromClickTarget
} from '@/utils/foundryHtml'
import ChatInlineRollModal from '@/components/ChatInlineRollModal.vue'
import ChatMessageRow from '@/components/ChatMessageRow.vue'
import ChatRecipientPicker from '@/components/ChatRecipientPicker.vue'
import CompendiumItemModal from '@/components/CompendiumItemModal.vue'
import InfoModal from '@/components/InfoModal.vue'
import ConfirmDialog from '@/components/widgets/ConfirmDialog.vue'
import type { ActiveRoll } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'

const isOpen = ref(false)
const chatInput = ref<HTMLTextAreaElement>()
// When set, the next message speaks as the player (their login user name)
// rather than in-character as the actor.
const outOfCharacter = ref(false)
const { zIndex, openLayer, closeLayer } = useOverlayStack()
const character = useInjectedActor()
const { _id, _actor, shield, skills, saves, perception } = character
const inlineRollModal = ref<InstanceType<typeof ChatInlineRollModal>>()
const compendiumModal = ref<InstanceType<typeof CompendiumItemModal>>()
const rerollModal = ref<InstanceType<typeof InfoModal>>()
const activeReroll = ref<ChatRerollRequest>()
const { t } = useI18n()

const { messages, renderedMessages, messageIsOwnActor } = useChatMessages(_id)

const chatStore = useChatStore()
const { isNativeMobile } = useServerAddressStore()

const {
  scrollContainer,
  isAtBottom,
  onScroll,
  positionOnOpen,
  stopOpenSettle,
  scrollToBottom,
  scrollToMessage
} = useChatScroll({ onAtBottom: () => chatStore.markAllRead() })

// Deep-link focus (from a push-notification tap): the message to land on when
// the overlay next opens, and the message to briefly highlight.
const pendingFocusId = ref<string | null>(null)
const highlightedId = ref<string | null>(null)
let highlightTimer: number | undefined

const {
  selectedWhisperMode,
  whisperGroupTargets,
  whisperUserTargets,
  selectedWhisperCommandTargets,
  selectedWhisperRecipientIds,
  whisperIntended,
  selectedWhisperLabel,
  selectWhisperGroup,
  toggleWhisperUser,
  userTargetSelected,
  selectWhisperUserFromMessage
} = useWhisperTargets()

const chatActions = useChatActions({
  actorId: _id,
  actor: _actor,
  shield,
  messages,
  messageIsOwnActor,
  onMessageSent: () => {
    scrollToBottom(true)
    // Safety net to return focus to the composer for rapid follow-up messages.
    // The send button's `@mousedown.prevent` already keeps the textarea focused
    // through a tap/click (so the iOS keyboard never drops and bounces back), so
    // in the normal case the textarea still holds focus and this is a no-op.
    nextTick(() => chatInput.value?.focus())
  }
})
const {
  draft,
  isSending,
  sendError,
  actionError,
  canSend,
  canTriggerRollAction,
  rerollRoll,
  submitMessage,
  submitVoiceMemo,
  submitImage,
  deleteMessage,
  updateMessageContent
} = chatActions

async function submitChatMessage() {
  const content = draft.value.trim()
  if (!content) return
  // Editing an existing message: save the new text rather than posting anew.
  if (editingMessageId.value) {
    const id = editingMessageId.value
    manageError.value = false
    try {
      await updateMessageContent(id, content)
      editingMessageId.value = null
      draft.value = ''
      nextTick(() => chatInput.value?.focus())
    } catch {
      manageError.value = true
    }
    return
  }
  // Whisper recipients ride as resolved user ids (the direct modifyDocument
  // create posts them straight into the message's `whisper` array) rather than
  // as a `/w …` command string the GM proxy would have re-parsed.
  submitMessage(content, {
    outOfCharacter: outOfCharacter.value,
    whisperIds: selectedWhisperRecipientIds.value,
    whisperIntended: whisperIntended.value
  })
}

// Grow the composer to fit the message up to the textarea's max-height (past
// that it scrolls). Runs on input and whenever the draft is set programmatically
// (edit populate, clear-on-send) or the textarea remounts after a voice/image
// state. Height is reset to auto first so it can also shrink back.
//
// The box's resting (unexpanded) height is captured whenever the draft is empty
// and applied to the send button, so the button matches the box exactly before
// it starts expanding — regardless of font metrics — and then stays put as the
// box grows for a long message.
const composerRestHeight = ref('')
function autoGrowComposer() {
  const el = chatInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
  if (!draft.value.trim()) composerRestHeight.value = `${el.offsetHeight}px`
}

// One delegated tap-tick for every control in the composer (recipient picker,
// OOC toggle, mic, attach, send, and the voice/image action buttons) — none of
// which carry their own haptic — so they all feel responsive without wiring
// each individually.
function onComposerPointerdown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, input[type="checkbox"]')) triggerLightHapticFeedback()
}
watch([draft, chatInput], () => nextTick(autoGrowComposer))

// ── Edit / delete own messages ───────────────────────────────────────────────
// Edit loads the message's text back into the composer (WhatsApp-style); Save
// routes through submitChatMessage above. Delete is confirmed inline in the row.
const editingMessageId = ref<string | null>(null)
const manageError = ref(false)

function startEdit(view: ChatMessageView) {
  const id = view.message._id
  if (!id) return
  editingMessageId.value = id
  draft.value = chatContentToEditableText(view.message.content)
  manageError.value = false
  nextTick(() => chatInput.value?.focus())
}

function cancelEdit() {
  editingMessageId.value = null
  draft.value = ''
}

// Delete is confirmed in a modal: the row's request opens the dialog; its
// confirm performs the delete.
const deleteDialog = ref<InstanceType<typeof ConfirmDialog>>()
const pendingDeleteView = ref<ChatMessageView | null>(null)

function requestDeleteMessage(view: ChatMessageView) {
  if (!view.message._id) return
  pendingDeleteView.value = view
  deleteDialog.value?.open()
}

async function performDeleteMessage() {
  const view = pendingDeleteView.value
  pendingDeleteView.value = null
  const id = view?.message._id
  if (!id) return
  // Leaving edit mode if we're deleting the very message being edited.
  if (editingMessageId.value === id) cancelEdit()
  manageError.value = false
  try {
    await deleteMessage(id)
  } catch {
    manageError.value = true
  }
}

// ── Voice memos ──────────────────────────────────────────────────────────
const versionCompat = useVersionCompatStore()
const listeners = useListenersStore()
const {
  isRecording,
  canPreview: canPreviewVoice,
  elapsedMs: recordElapsedMs,
  errorKind: recordErrorKind,
  recordedUrl,
  recordedBlob,
  mimeType: recordMimeType,
  maxDurationMs: recordMaxMs,
  start: startRecording,
  stop: stopRecording,
  reset: resetRecording
} = useAudioRecorder({ maxDurationMs: 300_000 })

// Offer the mic only when this device can actually record (secure context +
// MediaRecorder), the connected module advertises voice-memo support (so an
// older module never shows an affordance whose RPC it would reject), AND a GM
// listener is currently online. Voice memos have no direct-socket path — the
// upload + post run entirely on the GM's client (foundry/handlers/chat.ts) —
// so with no listener there's nothing to receive the recording; hide the mic
// rather than let the user record into a dead RPC. Device support is static
// for the session; module support and listener presence are reactive.
const voiceDeviceSupported = audioRecordingSupported()
const canRecordVoice = computed(
  () => voiceDeviceSupported && versionCompat.supportsVoiceMemo && listeners.isListening
)

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

async function submitCurrentVoiceMemo() {
  const blob = recordedBlob.value
  if (!blob) return
  const whisper = selectedWhisperCommandTargets.value
  await submitVoiceMemo(blob, {
    mimeType: recordMimeType.value,
    durationMs: Math.round(recordElapsedMs.value),
    outOfCharacter: outOfCharacter.value,
    whisper: whisper.length ? whisper : undefined
  })
  // Keep the take on failure so the user can retry; clear it once it's sent.
  if (!sendError.value) resetRecording()
}

// ── Images ─────────────────────────────────────────────────────────────────
// Mirrors the voice memo path: a picked image is prepared (downscaled) client-
// side, previewed inline, then chunk-streamed to the GM on send.
const {
  prepared: imagePrepared,
  previewUrl: imagePreviewUrl,
  errorKind: imageErrorKind,
  hasImage,
  pick: pickImage,
  reset: resetImage
} = useImageAttachment()
const imageInput = ref<HTMLInputElement>()

// Offer the attach button on the same conditions as the mic: this device can
// prepare an image, the module advertises the capability (a configured folder),
// and a GM listener is online to receive the upload (there's no direct-socket
// path — foundry/handlers/chat.ts does the upload + post on the GM's client).
const imageDeviceSupported = imageUploadSupported()
const canAttachImage = computed(
  () => imageDeviceSupported && versionCompat.supportsImageUpload && listeners.isListening
)

function openImagePicker() {
  imageInput.value?.click()
}

// ── Reactions ──────────────────────────────────────────────────────────────
// Same gate shape as the media affordances, for the same reason: a reaction
// writes a flag on another user's message, which only a GM may do, so it runs as
// an RPC on the GM's client with no direct-socket fallback. Resolved once here
// and handed to every row as a prop rather than each row subscribing to the
// store. Existing chips still render when this is false — they're just inert,
// so a log doesn't visibly lose data when the last GM drops off.
const reactionsSupported = computed(() => versionCompat.supportsReactions && listeners.isListening)

// Who-reacted sheet, opened by a long-press on a chip. Holds the message id
// rather than the view object so the list re-resolves from renderedMessages as
// reactions change while the sheet is open — a view is rebuilt on every world
// trigger, so a captured one would freeze at its open-time contents.
const reactionDetailId = ref<string | null>(null)
const reactionsModal = ref<InstanceType<typeof InfoModal>>()
const reactionDetail = computed(() =>
  reactionDetailId.value
    ? renderedMessages.value.find((view) => view.message._id === reactionDetailId.value)
    : undefined
)

function openReactionDetail(view: ChatMessageView) {
  reactionDetailId.value = view.message._id ?? null
  if (!reactionDetailId.value) return
  nextTick(() => reactionsModal.value?.open())
}

// Toggling from the sheet's rows. Resolved here rather than in the template so
// the null-check lives in script, not behind a template non-null assertion.
function toggleDetailReaction(emoji: string) {
  const message = reactionDetail.value?.message
  if (message) void chatActions.toggleMessageReaction(message, emoji)
}

function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Clear the input so re-picking the same file still fires change.
  input.value = ''
  void pickImage(file)
}

// Paste an image straight into the composer (desktop Cmd/Ctrl+V, or the mobile
// long-press "Paste"). Works in the browser and both WebViews via the standard
// paste event. Only intercepts when the clipboard actually holds an image and
// the feature is available — a normal text paste is left to proceed.
function onPaste(event: ClipboardEvent) {
  if (!canAttachImage.value) return
  const file = imageFileFromTransfer(event.clipboardData)
  if (!file) return
  event.preventDefault()
  void pickImage(file)
}

const imageErrorMessage = computed(() => {
  switch (imageErrorKind.value) {
    case 'invalid':
      return t('chat.imageInvalid')
    case 'too-large':
      return t('chat.imageTooLarge')
    default:
      return t('chat.imageFailed')
  }
})

async function submitCurrentImage() {
  const image = imagePrepared.value
  if (!image) return
  const whisper = selectedWhisperCommandTargets.value
  await submitImage(image, {
    outOfCharacter: outOfCharacter.value,
    whisper: whisper.length ? whisper : undefined
  })
  // Keep the selection on failure so the user can retry; clear once it's sent.
  if (!sendError.value) resetImage()
}

// On the native mobile keyboard there's no modifier key to reach for, so a bare
// Enter should insert a line break (let the default through) rather than send.
// On desktop, bare Enter still sends; use Shift+Enter for a line break.
function onEnterKey(event: KeyboardEvent) {
  if (isNativeMobile) return
  event.preventDefault()
  submitChatMessage()
}

// Key of the first message that falls below the frozen "new messages" divider,
// so the template can render the separator immediately before that row.
const firstUnreadKey = computed(
  () => renderedMessages.value.find((view) => chatStore.isUnread(view.message))?.key ?? null
)

const rerollModalRolls = computed<Roll[]>(() => {
  const active = activeReroll.value
  if (!active) return []
  return [
    {
      key: `chat-reroll:${active.message._id ?? 'message'}:${active.rollIndex}:${active.mode}`,
      label: t(rerollLabelKey(active.mode)),
      color: active.mode === 'hero-point' ? 'green' : 'blue',
      dice: ['d20'],
      armed: true,
      disabled: !canTriggerRollAction(active.message, active.roll, active.rollIndex, active.mode),
      execute: (faces) =>
        rerollRoll(active.message, active.roll, active.rollIndex, active.mode, faces)
    }
  ]
})

function openRerollModal(request: ChatRerollRequest) {
  if (!canTriggerRollAction(request.message, request.roll, request.rollIndex, request.mode)) return
  activeReroll.value = request
  nextTick(() => rerollModal.value?.open())
}

function openInlineRoll(roll: ActiveRoll | undefined) {
  if (!roll) return
  inlineRollModal.value?.open(roll)
}

const checkSlugLabels = computed(() => {
  const map: Record<string, string> = {}
  for (const skill of skills.value ?? []) {
    if (skill.slug && skill.label) map[skill.slug] = skill.label
  }
  if (saves.fortitude.value?.label) map.fortitude = saves.fortitude.value.label
  if (saves.reflex.value?.label) map.reflex = saves.reflex.value.label
  if (saves.will.value?.label) map.will = saves.will.value.label
  if (perception.value?.label) map.perception = perception.value.label
  return map
})

function inlineCheckLabel(check: ActiveRoll): string {
  const name = (check.slug && checkSlugLabels.value[check.slug]) || check.slug || ''
  if (check.dc) return t('chat.inlineCheckDc', { name, dc: check.dc })
  if (check.against) return t('chat.inlineCheckVs', { name, against: check.against })
  return t('chat.inlineCheck', { name })
}

function openLocalizedInlineRoll(check: ActiveRoll) {
  openInlineRoll({ ...check, label: inlineCheckLabel(check) })
}

function handleChatContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const compendiumUuid = compendiumItemUuidFromClickTarget(target)
  if (compendiumUuid) {
    event.preventDefault()
    event.stopPropagation()
    compendiumModal.value?.open(compendiumUuid)
    return
  }

  const roll = activeRollFromFoundryClickTarget(target)
  if (!roll) return
  event.preventDefault()
  event.stopPropagation()
  openInlineRoll(roll)
}

function open() {
  openLayer()
  selectWhisperGroup(PUBLIC_WHISPER_TARGET)
  outOfCharacter.value = false
  // Freeze the divider at the current read position before the list paints, so
  // the "new messages" separator marks where the user left off.
  chatStore.beginSession()
  isOpen.value = true
}

function close() {
  isOpen.value = false
  stopOpenSettle()
  closeLayer()
  // Drop any in-progress edit so reopening starts clean.
  if (editingMessageId.value) cancelEdit()
}

onBeforeUnmount(() => {
  closeLayer()
  if (highlightTimer) window.clearTimeout(highlightTimer)
})

watch(
  () => isOpen.value,
  (openNow) => {
    if (openNow) {
      // A pending deep-link target overrides the usual "land on unread divider".
      const focus = pendingFocusId.value
      pendingFocusId.value = null
      if (focus) scrollToMessage(focus)
      else positionOnOpen()
    } else stopOpenSettle()
  }
)

// Focus a specific message (deep link): highlight it, and either scroll now (if
// already open) or open — the isOpen watch scrolls once the panel is up.
function focusMessage(id: string) {
  highlightedId.value = id
  if (highlightTimer) window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => (highlightedId.value = null), 4000)
  if (isOpen.value) scrollToMessage(id)
  else {
    pendingFocusId.value = id
    open()
  }
}

// A push tap sets pendingFocusMessageId on the store; react here. `immediate`
// covers a cold start where the tap fired before this overlay mounted.
watch(
  () => chatStore.pendingFocusMessageId,
  (id) => {
    if (!id) return
    chatStore.consumeFocusMessage()
    focusMessage(id)
  },
  { immediate: true }
)

watch(
  () => messages.value.length,
  (messageCount, previousMessageCount) => {
    // Only follow new arrivals when already at the bottom, so a user reading
    // back at the divider keeps their place. Reaching the bottom marks read.
    if (isOpen.value && messageCount > previousMessageCount && isAtBottom.value) {
      scrollToBottom(true)
      chatStore.markAllRead()
    }
  }
)

defineExpose({ open, close, isOpen })
</script>

<template>
  <TransitionRoot appear :show="isOpen" as="template">
    <Dialog as="div" class="relative touch-manipulation" :style="{ zIndex }" @close="close">
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/35" />
      </TransitionChild>

      <div
        data-part="viewport"
        class="fixed overflow-hidden p-0 sm:p-4"
        style="inset: var(--tm-safe-area-top) var(--tm-safe-area-right) 0 var(--tm-safe-area-left)"
      >
        <div class="flex h-full items-stretch justify-center text-left sm:items-center">
          <TransitionChild
            as="template"
            enter="duration-200 ease-out"
            enter-from="opacity-0 translate-y-4 sm:scale-95 sm:translate-y-0"
            enter-to="opacity-100 translate-y-0 sm:scale-100"
            leave="duration-150 ease-in"
            leave-from="opacity-100 translate-y-0 sm:scale-100"
            leave-to="opacity-0 translate-y-4 sm:scale-95 sm:translate-y-0"
          >
            <DialogPanel
              data-component="ChatOverlay"
              data-part="panel"
              class="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl transition-all sm:h-[calc(100dvh-2rem)] sm:rounded-lg"
            >
              <header class="border-divider flex h-14 flex-none items-center gap-3 border-b px-4">
                <DialogTitle as="h3" class="text-lg leading-6 font-medium text-gray-900">
                  {{ $t('chat.title') }}
                </DialogTitle>
                <span class="text-sm text-gray-500">
                  {{ $t('chat.messageCount', { count: messages.length }) }}
                </span>
                <button
                  data-part="close"
                  class="ml-auto rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-hidden"
                  type="button"
                  @pointerdown="triggerLightHapticFeedback()"
                  @click="close"
                >
                  <span class="sr-only">{{ $t('common.close') }}</span>
                  <XMarkIcon class="h-6 w-6" aria-hidden="true" />
                </button>
              </header>

              <div
                ref="scrollContainer"
                data-part="chat-scroll"
                class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4"
                @scroll="onScroll"
              >
                <div
                  v-if="messages.length === 0"
                  class="px-3 py-8 text-center text-gray-500 italic"
                >
                  {{ $t('chat.noMessages') }}
                </div>
                <ol v-else class="flex flex-col">
                  <template v-for="view in renderedMessages" :key="view.key">
                    <li
                      v-if="view.key === firstUnreadKey"
                      data-part="chat-new-divider"
                      data-first-unread
                      aria-hidden="true"
                      class="mt-3 flex items-center gap-2 py-1 text-xs font-semibold tracking-wide text-blue-600 uppercase"
                    >
                      <span class="h-px flex-1 bg-blue-300" />
                      {{ $t('chat.newMessages') }}
                      <span class="h-px flex-1 bg-blue-300" />
                    </li>
                    <ChatMessageRow
                      :view="view"
                      :unread="chatStore.isUnread(view.message)"
                      :highlighted="highlightedId === view.message._id"
                      :actor-id="_id"
                      :inline-check-label="inlineCheckLabel"
                      :actions="chatActions"
                      :group-start="view.groupStart || view.key === firstUnreadKey"
                      :group-end="view.groupEnd"
                      :reactions-supported="reactionsSupported"
                      @select-author="selectWhisperUserFromMessage(view)"
                      @content-click="handleChatContentClick($event)"
                      @open-inline-check="openLocalizedInlineRoll($event)"
                      @open-reroll="openRerollModal($event)"
                      @edit="startEdit($event)"
                      @delete="requestDeleteMessage($event)"
                      @show-reactions="openReactionDetail($event)"
                    />
                  </template>
                </ol>
                <p
                  v-if="actionError"
                  data-part="chat-action-error"
                  class="mt-3 px-1 text-xs text-red-700"
                  role="status"
                >
                  {{ $t('chat.actionFailed') }}
                </p>
              </div>

              <form
                data-part="chat-composer"
                class="border-divider flex flex-none flex-col border-t p-3"
                :data-private="selectedWhisperCommandTargets.length ? true : undefined"
                @submit.prevent="submitChatMessage"
                @pointerdown="onComposerPointerdown"
              >
                <!-- Editing banner: replaces the recipient picker while editing
                     an existing message (recipients/OOC can't change on an edit). -->
                <div
                  v-if="editingMessageId"
                  data-part="chat-editing-banner"
                  class="mb-2 flex items-center gap-2 px-1 text-xs text-gray-500"
                >
                  <span class="flex-1">{{ $t('chat.editingMessage') }}</span>
                  <button
                    type="button"
                    class="rounded-md text-gray-400 hover:text-gray-600 focus:outline-hidden"
                    :aria-label="$t('common.cancel')"
                    @click="cancelEdit"
                  >
                    <XMarkIcon class="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <!-- Recipient picker stays put across all three states; only the
                     input row below it swaps. -->
                <ChatRecipientPicker
                  v-else
                  :group-targets="whisperGroupTargets"
                  :user-targets="whisperUserTargets"
                  :selected-mode="selectedWhisperMode"
                  :selected-label="selectedWhisperLabel"
                  :is-private="selectedWhisperCommandTargets.length > 0"
                  :is-user-selected="userTargetSelected"
                  :out-of-character="outOfCharacter"
                  @select-group="selectWhisperGroup($event)"
                  @toggle-user="toggleWhisperUser($event)"
                  @toggle-out-of-character="outOfCharacter = $event"
                />

                <!-- Hidden picker the attach button triggers; accept="image/*"
                     offers camera + library on mobile. -->
                <input
                  ref="imageInput"
                  type="file"
                  accept="image/*"
                  class="hidden"
                  @change="onImagePicked"
                />

                <!-- items-end so the fixed-height (h-14.5) action button stays put
                     at the bottom while the textarea auto-grows upward for a long
                     message. Every mode shares that resting height — the textarea's
                     min-h and the record/preview boxes' min-h all equal the button
                     height (3.625rem: 2 rows text-sm + py-2 + border) — so short
                     content and mode switches never change the composer's height. -->
                <div class="flex items-end gap-2">
                  <div class="relative min-w-0 flex-1">
                    <!-- Recording: cancel is tucked inside the box, so only the
                         stop button sits outside as the single primary action. -->
                    <div
                      v-if="isRecording"
                      data-part="chat-voice-recording"
                      class="flex min-h-14.5 items-center gap-3 rounded-md border border-red-300 bg-red-50 py-2 pr-1.5 pl-3"
                    >
                      <span
                        class="h-3 w-3 flex-none animate-pulse rounded-full bg-red-600"
                        aria-hidden="true"
                      />
                      <span class="flex-1 text-sm text-gray-900 tabular-nums">
                        {{ formatElapsed(recordElapsedMs) }} / {{ formatElapsed(recordMaxMs) }}
                      </span>
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-red-700 transition-colors hover:bg-red-100 active:bg-red-200"
                        :aria-label="$t('chat.cancelRecording')"
                        @click="resetRecording"
                      >
                        <XMarkIcon class="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>

                    <!-- Recorded take: inline preview player. -->
                    <div
                      v-else-if="canPreviewVoice"
                      data-part="chat-voice-preview"
                      class="flex min-h-14.5 items-center"
                    >
                      <audio
                        :src="recordedUrl ?? undefined"
                        controls
                        preload="metadata"
                        class="h-10 w-full"
                      />
                    </div>

                    <!-- Picked image: inline thumbnail preview. -->
                    <div
                      v-else-if="hasImage"
                      data-part="chat-image-preview"
                      class="flex min-h-14.5 items-center gap-3 rounded-md border border-gray-300 bg-gray-50 p-1.5"
                    >
                      <img
                        v-if="imagePreviewUrl"
                        :src="imagePreviewUrl"
                        alt=""
                        class="h-12 w-12 flex-none rounded object-cover"
                      />
                      <span class="min-w-0 flex-1 truncate text-sm text-gray-600">
                        {{ $t('chat.imageReady') }}
                      </span>
                    </div>

                    <!-- Default text input. -->
                    <div v-else class="relative">
                      <textarea
                        ref="chatInput"
                        v-model="draft"
                        class="block max-h-32 min-h-14.5 w-full resize-none overflow-y-auto rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                        rows="2"
                        :placeholder="$t('chat.placeholder')"
                        :disabled="!_id"
                        @input="autoGrowComposer"
                        @keydown.enter.exact="onEnterKey"
                        @keydown.meta.enter.prevent="submitChatMessage"
                        @keydown.ctrl.enter.prevent="submitChatMessage"
                        @keydown.esc="editingMessageId && cancelEdit()"
                        @paste="onPaste"
                      />
                      <!-- Attach + mic sit inside the empty composer; they hide as
                           soon as the user starts typing so they never crowd the
                           text or claim layout space of their own. Suppressed while
                           editing so an emptied draft can't surface them mid-edit. -->
                      <div
                        v-if="
                          !editingMessageId && !draft.trim() && (canAttachImage || canRecordVoice)
                        "
                        class="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5"
                      >
                        <button
                          v-if="canAttachImage"
                          type="button"
                          data-part="chat-attach-image"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                          :disabled="!_id"
                          :aria-label="$t('chat.attachImage')"
                          @click="openImagePicker"
                          @mousedown.prevent
                        >
                          <PhotoIcon class="h-5 w-5" aria-hidden="true" />
                        </button>
                        <button
                          v-if="canRecordVoice"
                          type="button"
                          data-part="chat-record"
                          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                          :disabled="!_id"
                          :aria-label="$t('chat.recordVoice')"
                          @click="startRecording"
                          @mousedown.prevent
                        >
                          <MicrophoneIcon class="h-5 w-5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Right-side action, swapped by state. No fixed height: the
                       row's items-stretch grows each button to the box height. -->
                  <button
                    v-if="isRecording"
                    type="button"
                    class="inline-flex h-14.5 w-12 flex-none items-center justify-center rounded-md bg-red-600 text-white transition-colors hover:bg-red-500 active:bg-red-400"
                    :aria-label="$t('chat.stopRecording')"
                    @click="stopRecording"
                  >
                    <StopIcon class="h-5 w-5" aria-hidden="true" />
                  </button>
                  <template v-else-if="canPreviewVoice">
                    <button
                      type="button"
                      class="inline-flex h-14.5 w-12 flex-none items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isSending"
                      :aria-label="$t('chat.discardRecording')"
                      @click="resetRecording"
                    >
                      <TrashIcon class="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-14.5 w-12 flex-none items-center justify-center rounded-md bg-blue-600 text-white transition-colors enabled:hover:bg-blue-500 enabled:active:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isSending"
                      :aria-label="$t('chat.sendVoice')"
                      @click="submitCurrentVoiceMemo"
                    >
                      <span
                        v-if="isSending"
                        class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      <PaperAirplaneIcon v-else class="h-5 w-5" aria-hidden="true" />
                    </button>
                  </template>
                  <template v-else-if="hasImage">
                    <button
                      type="button"
                      class="inline-flex h-14.5 w-12 flex-none items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isSending"
                      :aria-label="$t('chat.discardImage')"
                      @click="resetImage"
                    >
                      <TrashIcon class="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-14.5 w-12 flex-none items-center justify-center rounded-md bg-blue-600 text-white transition-colors enabled:hover:bg-blue-500 enabled:active:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isSending"
                      :aria-label="$t('chat.sendImage')"
                      @click="submitCurrentImage"
                    >
                      <span
                        v-if="isSending"
                        class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      <PaperAirplaneIcon v-else class="h-5 w-5" aria-hidden="true" />
                    </button>
                  </template>
                  <button
                    v-else
                    type="submit"
                    class="inline-flex h-14.5 w-12 flex-none items-center justify-center rounded-md bg-blue-600 text-white transition-colors enabled:hover:bg-blue-500 enabled:active:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                    :style="composerRestHeight ? { height: composerRestHeight } : undefined"
                    :disabled="!canSend"
                    :aria-label="editingMessageId ? $t('chat.saveEdit') : $t('chat.send')"
                    @mousedown.prevent
                  >
                    <span
                      v-if="isSending"
                      class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />
                    <PaperAirplaneIcon v-else class="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <p v-if="sendError" data-part="chat-error" class="mt-1 text-xs text-red-700">
                  {{ recordErrorKind ? $t('chat.micDenied') : $t('chat.sendFailed') }}
                </p>
                <p
                  v-else-if="recordErrorKind"
                  data-part="chat-voice-error"
                  class="mt-1 text-xs text-red-700"
                >
                  {{ $t('chat.micDenied') }}
                </p>
                <p
                  v-else-if="imageErrorKind"
                  data-part="chat-image-error"
                  class="mt-1 text-xs text-red-700"
                >
                  {{ imageErrorMessage }}
                </p>
                <p
                  v-else-if="manageError"
                  data-part="chat-manage-error"
                  class="mt-1 text-xs text-red-700"
                  role="status"
                >
                  {{ $t('chat.manageFailed') }}
                </p>
              </form>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
      <ChatInlineRollModal ref="inlineRollModal" />
      <CompendiumItemModal ref="compendiumModal" />
      <ConfirmDialog
        ref="deleteDialog"
        :title="$t('chat.confirmDelete')"
        :message="$t('chat.deleteBody')"
        :confirm-label="$t('common.delete')"
        :cancel-label="$t('common.cancel')"
        danger
        @confirm="performDeleteMessage"
        @cancel="pendingDeleteView = null"
      />
      <InfoModal ref="rerollModal" :rolls="rerollModalRolls" @closing="activeReroll = undefined">
        <template #title>
          {{ activeReroll ? $t(rerollLabelKey(activeReroll.mode)) : $t('chat.rollActions') }}
        </template>
        <template #description>
          <div v-if="activeReroll" class="mt-1 text-sm text-gray-500">
            <span>{{ rollKindLabel(activeReroll.roll) }}</span>
            <span v-if="activeReroll.roll.total !== undefined">
              {{ ` ${activeReroll.roll.total}` }}
            </span>
            <span v-if="activeReroll.roll.formula">
              {{ ` - ${rollFormulaLabel(activeReroll.roll)}` }}
            </span>
          </div>
        </template>
      </InfoModal>
      <!-- Who reacted with what. One row per emoji, listing the reactor names the
           chip's hover tooltip shows on desktop — the same data, reachable by
           touch. Tapping a row toggles this user's own reaction, so the sheet
           doubles as a picker for emoji already on the message. -->
      <InfoModal ref="reactionsModal" @closing="reactionDetailId = null">
        <template #title>{{ $t('chat.reactionsTitle') }}</template>
        <ul data-part="chat-reaction-detail" class="mt-2 divide-y divide-gray-100">
          <li v-for="group in reactionDetail?.reactions ?? []" :key="group.emoji">
            <button
              type="button"
              data-part="chat-reaction-detail-row"
              :data-mine="group.mine || undefined"
              :disabled="!reactionsSupported"
              class="flex w-full items-center gap-3 py-2 text-left disabled:opacity-60"
              @click="toggleDetailReaction(group.emoji)"
            >
              <span class="text-2xl leading-none" aria-hidden="true">{{ group.emoji }}</span>
              <span class="min-w-0 flex-1 text-sm text-gray-700">{{ group.names.join(', ') }}</span>
              <span v-if="group.mine" class="flex-none text-xs text-blue-700">
                {{ $t('chat.reactionMine') }}
              </span>
            </button>
          </li>
        </ul>
      </InfoModal>
    </Dialog>
  </TransitionRoot>
</template>
