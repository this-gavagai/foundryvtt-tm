<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'
import {
  MicrophoneIcon,
  PaperAirplaneIcon,
  StopIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/vue/24/outline'
import { useInjectedActor } from '@/composables/injectKeys'
import { useOverlayStack } from '@/composables/useOverlayStack'
import { useAudioRecorder, audioRecordingSupported } from '@/composables/useAudioRecorder'
import { useChatStore } from '@/stores/chat'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useChatActions, type ChatRerollRequest } from '@/composables/useChatActions'
import { useChatMessages } from '@/composables/useChatMessages'
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

const { scrollContainer, isAtBottom, onScroll, positionOnOpen, stopOpenSettle, scrollToBottom, scrollToMessage } =
  useChatScroll({ onAtBottom: () => chatStore.markAllRead() })

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
  selectedWhisperLabel,
  selectWhisperGroup,
  toggleWhisperUser,
  userTargetSelected,
  selectWhisperUserFromMessage,
  whisperContent
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
  submitVoiceMemo
} = chatActions

function submitChatMessage() {
  const content = draft.value.trim()
  if (!content) return
  submitMessage(whisperContent(content), { outOfCharacter: outOfCharacter.value })
}

// ── Voice memos ──────────────────────────────────────────────────────────
const versionCompat = useVersionCompatStore()
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
// MediaRecorder) AND the connected module advertises voice-memo support — so
// an older module never shows an affordance whose RPC it would reject. Device
// support is static for the session; module support is reactive.
const voiceDeviceSupported = audioRecordingSupported()
const canRecordVoice = computed(
  () => voiceDeviceSupported && versionCompat.supportsVoiceMemo
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
                <ol v-else class="flex flex-col gap-3">
                  <template v-for="view in renderedMessages" :key="view.key">
                    <li
                      v-if="view.key === firstUnreadKey"
                      data-part="chat-new-divider"
                      data-first-unread
                      aria-hidden="true"
                      class="flex items-center gap-2 py-1 text-xs font-semibold tracking-wide text-blue-600 uppercase"
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
                      @select-author="selectWhisperUserFromMessage(view)"
                      @content-click="handleChatContentClick($event)"
                      @open-inline-check="openLocalizedInlineRoll($event)"
                      @open-reroll="openRerollModal($event)"
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
              >
                <!-- Recipient picker stays put across all three states; only the
                     input row below it swaps. -->
                <ChatRecipientPicker
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

                <!-- items-stretch: the action button(s) grow to exactly the input
                     box's height in every state, so the box and its button read as
                     one full-height unit regardless of which mode is showing. The
                     record/preview boxes are pinned to the textarea's rendered
                     height (2 rows text-sm + py-2 + border = 3.625rem) so switching
                     modes never changes the composer's height. -->
                <div class="flex items-stretch gap-2">
                  <div class="relative min-w-0 flex-1">
                    <!-- Recording: cancel is tucked inside the box, so only the
                         stop button sits outside as the single primary action. -->
                    <div
                      v-if="isRecording"
                      data-part="chat-voice-recording"
                      class="flex min-h-[3.625rem] items-center gap-3 rounded-md border border-red-300 bg-red-50 py-2 pr-1.5 pl-3"
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
                      class="flex min-h-[3.625rem] items-center"
                    >
                      <audio
                        :src="recordedUrl ?? undefined"
                        controls
                        preload="metadata"
                        class="h-10 w-full"
                      />
                    </div>

                    <!-- Default text input. -->
                    <div v-else class="relative">
                      <textarea
                        ref="chatInput"
                        v-model="draft"
                        class="block max-h-32 min-h-12 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                        rows="2"
                        :placeholder="$t('chat.placeholder')"
                        :disabled="!_id"
                        @keydown.enter.exact="onEnterKey"
                        @keydown.meta.enter.prevent="submitChatMessage"
                        @keydown.ctrl.enter.prevent="submitChatMessage"
                      />
                      <!-- Mic sits inside the empty composer; it hides as soon as
                           the user starts typing so it never crowds the text or
                           claims layout space of its own. -->
                      <button
                        v-if="canRecordVoice && !draft.trim()"
                        type="button"
                        data-part="chat-record"
                        class="absolute top-1/2 right-1.5 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!_id"
                        :aria-label="$t('chat.recordVoice')"
                        @click="startRecording"
                        @mousedown.prevent
                      >
                        <MicrophoneIcon class="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <!-- Right-side action, swapped by state. No fixed height: the
                       row's items-stretch grows each button to the box height. -->
                  <button
                    v-if="isRecording"
                    type="button"
                    class="inline-flex w-12 flex-none items-center justify-center rounded-md bg-red-600 text-white transition-colors hover:bg-red-500 active:bg-red-400"
                    :aria-label="$t('chat.stopRecording')"
                    @click="stopRecording"
                  >
                    <StopIcon class="h-5 w-5" aria-hidden="true" />
                  </button>
                  <template v-else-if="canPreviewVoice">
                    <button
                      type="button"
                      class="inline-flex w-12 flex-none items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="isSending"
                      :aria-label="$t('chat.discardRecording')"
                      @click="resetRecording"
                    >
                      <TrashIcon class="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex w-12 flex-none items-center justify-center rounded-md bg-blue-600 text-white transition-colors enabled:hover:bg-blue-500 enabled:active:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
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
                  <button
                    v-else
                    type="submit"
                    class="inline-flex w-12 flex-none items-center justify-center rounded-md bg-blue-600 text-white transition-colors enabled:hover:bg-blue-500 enabled:active:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!canSend"
                    :aria-label="$t('chat.send')"
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
              </form>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
      <ChatInlineRollModal ref="inlineRollModal" />
      <CompendiumItemModal ref="compendiumModal" />
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
    </Dialog>
  </TransitionRoot>
</template>
