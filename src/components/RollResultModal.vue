<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from './ModalBox.vue'
import ChatCommentModal from './ChatCommentModal.vue'
import { useChatComments } from '@/composables/useChatComments'
import { useUserStore } from '@/stores/user'
import { useWorldStore } from '@/stores/world'
import { type ChatComment } from '@/utils/chatComments'
import { dieIcons } from '@/utils/chatRollDisplay'
import { formatModifier } from '@/utils/formatters'
import { getPath } from '@/utils/utilities'
import type { RequestResolutionArgs, RolledDie } from '@/types/api-types'

const modal = ref<InstanceType<typeof Modal>>()
const result = ref<RequestResolutionArgs | null | undefined>()
const roll = computed(() => result.value?.roll)

type DisplayDieResult = RolledDie['results'][number]

// Just enough of a cached chat message to find this roll's card and read its
// comment flag off it.

const rollDice = computed(() => roll.value?.dice ?? [])

function dieIconForFaces(faces: number) {
  return dieIcons[faces]
}

const singleD20Result = computed(() => {
  if (roll.value?.isSecret) return null
  const d20Results = rollDice.value.filter((die) => die.faces === 20).flatMap((die) => die.results)
  return d20Results.length === 1 ? d20Results[0] : null
})

// ── What the roll was aimed at, and how it came out ────────────────────────
// The module reads this off the chat card PF2e posted and withholds, field by
// field, whatever the world does not show this player (see
// foundry/utils/rollOutcome.ts). So everything here is drawn only if it
// arrived: a skill check against nothing shows none of it, a strike shows all
// of it, and a check whose DC the GM keeps hidden shows the degree without the
// number it was measured against.
//
// A secret roll shows none of it. The total above is already '???' for one, and
// the degree of success — or the margin, from a visible DC — would answer the
// question the blind roll exists to keep from the roller.
const outcome = computed(() => (roll.value?.isSecret ? undefined : result.value?.outcome))

const hasTargetLine = computed(
  () => !!outcome.value?.targetName || !!outcome.value?.targetImg || outcome.value?.dc !== undefined
)

// PF2e's own wording for the degree: an attack reads Hit/Miss, everything else
// Success/Failure. Translated here rather than on the module side — these four
// words are the app's own vocabulary, the way the reroll labels are, and belong
// in the reader's language rather than the world's.
function degreeKey(degree: string, scope: string | undefined) {
  return `rollResult.degree.${scope === 'attack' ? 'attack' : 'check'}.${degree}`
}

const degreeLabelKey = computed(() => {
  const degree = outcome.value?.degree
  return degree ? degreeKey(degree, outcome.value?.scope) : undefined
})

// The degree the dice alone would have produced, when an adjustment (Assurance,
// an effect that upgrades a success) moved it. Shown struck through beside the
// one that counted, which is how PF2e words it too.
const unadjustedLabelKey = computed(() => {
  const degree = outcome.value?.unadjustedDegree
  return degree ? degreeKey(degree, outcome.value?.scope) : undefined
})

// How far past the DC the roll landed, signed — only when both numbers are in
// hand, which is exactly when PF2e shows it on the card.
const offset = computed(() => {
  const dc = outcome.value?.dc
  const total = roll.value?.total
  if (dc === undefined || typeof total !== 'number') return undefined
  return formatModifier(total - dc)
})

const DEGREE_CLASSES: Record<string, string> = {
  criticalSuccess: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
  failure: 'bg-rose-50 text-rose-800 ring-rose-100',
  criticalFailure: 'bg-rose-100 text-rose-900 ring-rose-200'
}

const degreeClass = computed(() => DEGREE_CLASSES[outcome.value?.degree ?? ''] ?? '')

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
const userStore = useUserStore()
const worldStore = useWorldStore()

// The chat card this roll posted, when the module could identify it.
const messageId = computed(() => result.value?.messageId)

const canComment = computed(
  // The world switch alone — no capability, no listener. A comment is written
  // directly to its author's own user document, so it needs no GM online, and
  // the setting only exists once a module that registers it has run in the
  // world, which covers version skew for free. See utils/worldSettings.ts.
  () => !!messageId.value && worldStore.commentsEnabled
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
  // Indexed by message id across every author (stores/world.ts), so this
  // resolves even for a card that has not reached the app's message cache yet —
  // which is exactly the case this panel exists for. No message lookup needed.
  const stored = worldStore.commentsFor(id)
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
  <div data-component="RollResultModalRoot">
    <Modal ref="modal">
      <!-- The theme hook lives INSIDE the panel: Modal's dialog portals its
           panel out to the document body, so a hook on the wrapper above would
           not contain any of this. -->
      <div data-component="RollResultModal">
        <!-- Who the roll was aimed at, above the dice: the token's art and name,
             and the DC it was measured against when the table plays with those
             visible. A flat-DC check arrives with no target and shows just the
             number. -->
        <div
          v-if="hasTargetLine"
          data-part="roll-target"
          class="mb-3 flex flex-wrap items-center justify-center gap-2"
        >
          <img
            v-if="outcome?.targetImg"
            :src="getPath(outcome.targetImg)"
            class="h-7 w-7 rounded-full object-cover ring-1 ring-gray-200"
            alt=""
            aria-hidden="true"
          />
          <span
            v-if="outcome?.targetName"
            data-part="roll-target-name"
            data-tone="muted"
            class="text-sm text-gray-500"
          >
            {{ $t('rollResult.versus', { name: outcome.targetName }) }}
          </span>
          <span
            v-if="outcome?.dc !== undefined"
            data-part="roll-dc"
            class="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-600"
          >
            {{ $t('rollResult.dc', { label: outcome.dcLabel ?? '', dc: outcome.dc }) }}
          </span>
        </div>
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
        <!-- How it came out, under the number: the degree of success, the margin
             it beat the DC by, and — when an adjustment moved it — the degree the
             dice alone would have given, struck through beside it. -->
        <div v-if="degreeLabelKey" data-part="roll-outcome" class="mt-3 text-center">
          <!-- The four degrees carry a state hook as well as the fallback
               palette below, so a theme can recolour them without restating the
               component's classes. -->
          <span
            data-part="roll-degree"
            :data-degree="outcome?.degree"
            class="inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset"
            :class="degreeClass"
          >
            <span
              v-if="unadjustedLabelKey"
              data-part="roll-degree-unadjusted"
              class="text-xs font-normal line-through opacity-60"
            >
              {{ $t(unadjustedLabelKey) }}
            </span>
            <span>{{ $t(degreeLabelKey) }}</span>
            <span
              v-if="offset"
              data-part="roll-degree-offset"
              class="text-xs font-normal opacity-70"
            >
              {{ $t('rollResult.offset', { offset }) }}
            </span>
          </span>
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
