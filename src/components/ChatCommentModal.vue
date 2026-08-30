<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'
import { useOverlayStack } from '@/composables/useOverlayStack'
import {
  triggerDismissHapticFeedback,
  triggerLightHapticFeedback
} from '@/composables/useHapticFeedback'
import { COMMENT_MAX_LENGTH, sanitizeCommentText } from '@/utils/chatComments'

// The comment editor: one comment, being written or rewritten.
//
// A modal rather than a mode on the chat composer. The composer is already a
// small state machine (posting, editing a message, editing a memo transcript,
// a recorded take, an attached image, whisper recipients, out-of-character) and
// every one of those states reads the same draft; a comment is a write to a
// DIFFERENT document than the one the composer posts to, so folding it in would
// make "what does Send do right now" depend on three flags instead of one.
//
// Structured like ConfirmDialog: a themed [data-part='panel'] inside a
// [role='dialog'], so it inherits the app's modal surface and text colors on
// every theme without per-theme CSS of its own.
const props = defineProps<{
  // The line under the title naming what is being commented on ("On Seelah's
  // message", "On this roll"), so a comment written from a long log can't land
  // on the wrong message unnoticed. A ready-made string rather than a name to
  // interpolate: the roll-result panel has no speaker to name, only "this roll".
  description: string
  // True while the write is in flight; the panel stays open (the text is still
  // the user's only copy) with its buttons inert.
  pending: boolean
  // Editing an existing comment rather than adding one: offers Remove, and
  // titles the panel accordingly.
  editing: boolean
  // The last write failed. Reported here rather than left to the caller's own
  // error line, which this panel is sitting on top of.
  failed?: boolean
}>()

const emit = defineEmits<{
  save: [text: string]
  remove: []
  cancel: []
}>()

const isOpen = ref(false)
const draft = ref('')
const input = ref<HTMLTextAreaElement>()
const { zIndex, openLayer, closeLayer } = useOverlayStack()

// The initial text is passed to open() rather than read from a prop: the caller
// sets its target and opens in the same tick, when a prop would still hold the
// previous comment's text.
function open(initialText = '') {
  draft.value = initialText
  openLayer()
  isOpen.value = true
  // Autofocus with the caret at the end, so an edit continues where the comment
  // left off instead of selecting it (one stray keypress from erasing it).
  nextTick(() => {
    const el = input.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

function close() {
  isOpen.value = false
  closeLayer()
}

const canSave = computed(() => !props.pending && !!sanitizeCommentText(draft.value))

function onSave() {
  if (!canSave.value) return
  triggerLightHapticFeedback()
  emit('save', sanitizeCommentText(draft.value))
}

function onRemove() {
  if (props.pending) return
  triggerLightHapticFeedback()
  emit('remove')
}

function onCancel() {
  if (props.pending) return
  triggerDismissHapticFeedback()
  emit('cancel')
  close()
}

defineExpose({ open, close, isOpen })
</script>

<template>
  <TransitionRoot appear :show="isOpen" as="template">
    <Dialog
      as="div"
      class="relative touch-manipulation"
      :style="{ zIndex }"
      :initial-focus="input"
      @close="onCancel"
    >
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/40" />
      </TransitionChild>

      <div class="fixed inset-0 flex items-center justify-center p-4">
        <TransitionChild
          as="template"
          enter="duration-200 ease-out"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="duration-150 ease-in"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel
            data-component="ChatCommentModal"
            data-part="panel"
            class="w-full max-w-sm rounded-lg bg-white p-5 text-left shadow-xl"
          >
            <DialogTitle as="h3" class="text-base font-semibold">
              {{ editing ? $t('chat.editComment') : $t('chat.addComment') }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm opacity-70">
              {{ description }}
            </DialogDescription>
            <textarea
              ref="input"
              v-model="draft"
              data-part="chat-comment-input"
              rows="4"
              :maxlength="COMMENT_MAX_LENGTH"
              :disabled="pending"
              :placeholder="$t('chat.commentPlaceholder')"
              class="mt-3 block max-h-48 w-full resize-none overflow-y-auto rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden disabled:opacity-60"
              @keydown.meta.enter.prevent="onSave"
              @keydown.ctrl.enter.prevent="onSave"
              @keydown.esc.prevent="onCancel"
            />
            <!-- A comment rides on the message it is about, so it inherits that
                 message's audience — a comment on a public roll is public,
                 including one a GM writes. Said plainly here because the
                 alternative assumption (that a GM's remark is a GM aside) is a
                 reasonable one to make and an unpleasant one to discover. -->
            <p data-tone="muted" class="mt-2 text-xs opacity-70">
              {{ $t('chat.commentVisibility') }}
            </p>
            <!-- Only counts down near the cap: a character counter on an empty
                 box is noise, but running out of room silently is worse. -->
            <p
              v-if="draft.length > COMMENT_MAX_LENGTH - 60"
              data-tone="muted"
              class="mt-1 text-right text-xs opacity-70"
            >
              {{ COMMENT_MAX_LENGTH - draft.length }}
            </p>
            <p
              v-if="failed"
              data-part="chat-comment-error"
              class="mt-2 text-xs text-red-600"
              role="status"
            >
              {{ $t('chat.commentFailed') }}
            </p>
            <div class="mt-4 flex items-center justify-end gap-2">
              <button
                v-if="editing"
                type="button"
                data-part="chat-comment-remove"
                class="mr-auto rounded-md px-3 py-2 text-sm font-medium text-red-600 transition-opacity hover:opacity-80 focus:outline-hidden disabled:opacity-50"
                :disabled="pending"
                @click="onRemove"
              >
                {{ $t('common.remove') }}
              </button>
              <button
                type="button"
                data-part="chat-comment-cancel"
                class="rounded-md px-3 py-2 text-sm font-medium opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden disabled:opacity-50"
                :disabled="pending"
                @click="onCancel"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                data-part="chat-comment-save"
                class="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 focus:outline-hidden active:bg-blue-700 disabled:opacity-50"
                :disabled="!canSave"
                :aria-busy="pending"
                @click="onSave"
              >
                {{ pending ? $t('chat.commentSaving') : $t('chat.commentSave') }}
              </button>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
