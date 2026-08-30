<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from './ModalBox.vue'
import ChatCommentModal from './ChatCommentModal.vue'
import { useChatComments } from '@/composables/useChatComments'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useListenersStore } from '@/stores/listenersOnline'
import { useUserStore } from '@/stores/user'
import { useWorldStore } from '@/stores/world'
import { readComments, type ChatComment } from '@/utils/chatComments'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import { dieIcons } from '@/utils/chatRollDisplay'
import type { RequestResolutionArgs, RolledDie } from '@/types/api-types'

const modal = ref<InstanceType<typeof Modal>>()
const result = ref<RequestResolutionArgs | null | undefined>()
const roll = computed(() => result.value?.roll)

type DisplayDieResult = RolledDie['results'][number]

// Just enough of a cached chat message to find this roll's card and read its
// comment flag off it.
type ChatMessageLike = { _id?: string | null; flags?: Record<string, unknown> | null }

const rollDice = computed(() => roll.value?.dice ?? [])

function dieIconForFaces(faces: number) {
  return dieIcons[faces]
}

const singleD20Result = computed(() => {
  if (roll.value?.isSecret) return null
  const d20Results = rollDice.value.filter((die) => die.faces === 20).flatMap((die) => die.results)
  return d20Results.length === 1 ? d20Results[0] : null
})

function d20ResultClass(dieResult: DisplayDieResult) {
  if (dieResult !== singleD20Result.value) return null
  if (dieResult.result === 20)
    return 'inline-block animate-nat-twenty text-green-700 motion-reduce:animate-none'
  if (dieResult.result === 1)
    return 'inline-block animate-nat-one text-red-700 motion-reduce:animate-none'
  return null
}

// ── Commenting on the roll just made ───────────────────────────────────────
// The moment a roll lands is when there is something to say about it, and it is
// also the one moment the roller isn't looking at the chat log. So the result
// panel offers the same comment editor the log does, on the card this roll
// posted — which the module names in the ack (see chatCapture.ts). A roll whose
// card couldn't be identified simply doesn't offer it.
const commentModal = ref<InstanceType<typeof ChatCommentModal>>()
const { saveComment, removeComment, isCommentPending, commentFailed } = useChatComments()
const versionCompat = useVersionCompatStore()
const listeners = useListenersStore()
const userStore = useUserStore()
const worldStore = useWorldStore()

// The chat card this roll posted, when the module could identify it.
const messageId = computed(() => result.value?.messageId)

const canComment = computed(
  () => !!messageId.value && versionCompat.supportsComments && listeners.isListening
)

// What this panel just wrote, straight off the ack. The panel opens the instant
// the roll resolves, which can be before the card itself has reached the app's
// message cache — so the store lookup below may find nothing for a moment, and
// without this the button would still read "Add comment" and a second save would
// write a second comment instead of editing the first.
const justWritten = ref<ChatComment | null>(null)

// This user's own comment on the roll, preferring the cached message (so an edit
// made from the chat log shows here) and falling back to what was just written.
// Only their own: the panel is a place to say something about your roll, not a
// second chat log.
const ownComment = computed(() => {
  const id = messageId.value
  const userId = userStore.userId
  if (!id || !userId) return undefined
  const messages = collectionToArray<ChatMessageLike>(
    worldStore.world?.messages as CollectionLike<ChatMessageLike>
  )
  const message = messages.find((entry) => entry._id === id)
  const stored = readComments(message)
  return (
    stored.filter((comment) => comment.userId === userId).at(-1) ?? justWritten.value ?? undefined
  )
})

// Ours, out of whatever the module stored — the comment the next edit targets.
function ownCommentIn(comments: ChatComment[]): ChatComment | null {
  const userId = userStore.userId
  if (!userId) return null
  return comments.filter((comment) => comment.userId === userId).at(-1) ?? null
}

const commentPending = computed(() => isCommentPending(messageId.value, ownComment.value?.id))

function openCommentEditor() {
  commentModal.value?.open(ownComment.value?.text ?? '')
}

async function submitComment(text: string) {
  // Only close on success: on a failure the text is still the user's only copy,
  // and the editor reports why.
  const stored = await saveComment(messageId.value, text, ownComment.value?.id)
  if (!stored) return
  justWritten.value = ownCommentIn(stored)
  commentModal.value?.close()
}

async function deleteComment() {
  const id = ownComment.value?.id
  if (!id) return
  const stored = await removeComment(messageId.value, id)
  if (!stored) return
  justWritten.value = ownCommentIn(stored)
  commentModal.value?.close()
}

function open(newResult: RequestResolutionArgs | null | undefined) {
  result.value = newResult
  // A fresh roll, so nothing has been written about it from here yet.
  justWritten.value = null
  modal.value?.open()
}

function close() {
  modal.value?.close()
}

const isOpen = computed(() => modal.value?.isOpen ?? false)

defineExpose({ open, close, isOpen })
</script>

<template>
  <!-- A plain wrapper so the editor below can be a SIBLING of the result panel
       rather than a child of it: both are dialogs, and nesting one inside the
       other's panel puts two focus traps in the same subtree. (The wrapper adds
       no layout of its own — both children render as fixed overlays.) -->
  <div>
    <Modal ref="modal">
      <div class="flex">
        <div class="m-auto">
          <div class="m-auto">{{ roll?.formula }}</div>
          <div
            class="flex items-center justify-center"
            v-for="(die, i) in rollDice"
            :key="'die_' + i"
          >
            <div class="flex gap-1 text-2xl">
              <div
                v-for="(dieResult, j) in die.results"
                :key="'result_' + j"
                class="align-items-center mr-1 flex gap-1"
              >
                <img
                  v-if="dieIconForFaces(die.faces)"
                  :src="dieIconForFaces(die.faces)"
                  class="mt-1 h-6 w-6"
                  :alt="$t('infoModal.dieImage', { faces: die.faces })"
                />
                <span :class="d20ResultClass(dieResult)">
                  {{ roll?.isSecret ? '?' : dieResult.result }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="m-auto">
          <div class="text-6xl">
            {{ roll?.isSecret ? '???' : roll?.total }}
          </div>
        </div>
      </div>
      <!-- Comment affordance, under the result: a plain text button rather than a
         filled one, so it stays out of the way of the number everyone is
         actually looking at. Once a comment exists it is shown above the button,
         which then reads as an edit — the roller can see what they said without
         leaving for the chat log. -->
      <div v-if="canComment" data-part="roll-comment" class="mt-4 text-center">
        <p
          v-if="ownComment"
          data-part="roll-comment-text"
          data-tone="muted"
          class="mb-1 text-sm whitespace-pre-line opacity-80"
        >
          {{ ownComment.text }}
        </p>
        <button
          type="button"
          data-part="roll-comment-button"
          class="text-xs font-medium underline underline-offset-2 opacity-60 transition-opacity hover:opacity-100 focus:outline-hidden disabled:opacity-40"
          :disabled="commentPending"
          @click="openCommentEditor"
        >
          {{ ownComment ? $t('chat.editComment') : $t('chat.addComment') }}
        </button>
      </div>
    </Modal>
    <ChatCommentModal
      ref="commentModal"
      :description="$t('chat.commentOnRoll')"
      :pending="commentPending"
      :editing="!!ownComment"
      :failed="commentFailed"
      @save="submitComment($event)"
      @remove="deleteComment()"
    />
  </div>
</template>
