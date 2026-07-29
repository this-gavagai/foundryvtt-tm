<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatMessageView } from '@/composables/useChatMessages'
import type { ChatActions, ChatRerollRequest } from '@/composables/useChatActions'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import ChatRollCard from '@/components/ChatRollCard.vue'
import KebabMenu from '@/components/widgets/KebabMenu.vue'
import d20Icon from '@/assets/icons/d20.svg'
import type { ActiveRoll } from '@/types/api-types'

const props = defineProps<{
  view: ChatMessageView
  unread: boolean
  // Briefly ringed after a push-notification tap deep-links to this message.
  highlighted?: boolean
  // Inline check buttons roll as the active character; without one they hide.
  actorId: string | null | undefined
  inlineCheckLabel: (check: ActiveRoll) => string
  actions: ChatActions
  // Grouping (from useChatMessages, possibly overridden at the unread divider):
  // groupStart shows the portrait/name header; groupEnd shows the timestamp and
  // rounds off the last bubble of a run.
  groupStart: boolean
  groupEnd: boolean
}>()

const emit = defineEmits<{
  // Tapping a name preselects that user as the whisper recipient.
  selectAuthor: []
  // Clicks inside Foundry-rendered HTML (compendium links, inline rolls) — the
  // overlay owns the modals those open.
  contentClick: [event: MouseEvent]
  openInlineCheck: [check: ActiveRoll]
  openReroll: [request: ChatRerollRequest]
  // Manage actions on the user's own message — the overlay owns the composer
  // edit-mode and the delete call.
  edit: [view: ChatMessageView]
  delete: [view: ChatMessageView]
}>()

const { t } = useI18n()

// Right-aligned, tinted bubble for the current user's own messages; left-aligned
// for everyone else. Both sides show a portrait + name at the top of a group, so
// the sender can see which character (or OOC alias) each message was posted as.
const isOwn = computed(() => props.view.isOwnMessage)
const showHeader = computed(() => props.groupStart)

// Edit/delete affordance, own messages only. Edit is offered just for plain-text
// posts (no rolls, voice, image, or reroll card — the only kind that can be
// meaningfully re-typed); delete works on any of the user's own messages.
const canManage = computed(() => isOwn.value && !!props.view.message._id)
const canEdit = computed(
  () =>
    canManage.value &&
    props.view.showContent &&
    !!props.view.preparedContent &&
    props.view.rolls.length === 0 &&
    !props.view.audioUrl &&
    !props.view.imageUrl &&
    !props.view.rerollSummary
)
const menuItems = computed(() => {
  const items: { id: string; label: string; danger?: boolean }[] = []
  if (canEdit.value) items.push({ id: 'edit', label: t('chat.edit') })
  items.push({ id: 'delete', label: t('common.delete'), danger: true })
  return items
})

// Delete is a two-step inline confirm (matching the app's other destructive
// actions) rather than a modal, so it stays contained in the row.
const confirmingDelete = ref(false)
function onMenuSelect(id: string) {
  if (id === 'edit') emit('edit', props.view)
  else if (id === 'delete') confirmingDelete.value = true
}
function confirmDelete() {
  confirmingDelete.value = false
  emit('delete', props.view)
}

// Square off the corner on the sender's side through the middle of a run so a
// group of bubbles reads as one connected column (the WhatsApp/Telegram look).
const bubbleClass = computed(() => {
  const classes = ['rounded-2xl']
  if (isOwn.value) {
    if (!props.groupStart) classes.push('rounded-tr-md')
    if (!props.groupEnd) classes.push('rounded-br-md')
    classes.push('bg-blue-100')
  } else {
    if (!props.groupStart) classes.push('rounded-tl-md')
    if (!props.groupEnd) classes.push('rounded-bl-md')
    classes.push('bg-gray-100')
  }
  return classes
})

function handleContentClick(event: MouseEvent) {
  emit('contentClick', event)
  props.actions.handleCardButtonClick(event)
}
</script>

<template>
  <li
    data-part="chat-message"
    class="group flex flex-col"
    :class="[isOwn ? 'items-end' : 'items-start', groupStart ? 'mt-5' : 'mt-0.5']"
    :data-message-id="view.message._id ?? undefined"
    :data-message-type="view.message.type"
    :data-private="!!view.visibilityLabel"
    :data-own-message="isOwn"
    :data-unread="unread || undefined"
  >
    <!-- Group header: the token at the screen edge with the character name, user
         name, and any whisper label stacked beside it — shown once above the
         first bubble of a group. No side gutter, so the bubbles below use the
         full width. flex-row-reverse puts the token on the far side for own
         messages. -->
    <div
      v-if="showHeader"
      class="mb-1.5 flex max-w-full items-center gap-2"
      :class="isOwn ? 'flex-row-reverse' : ''"
    >
      <!-- overflow-visible so a token whose art is scaled past its frame
           (scaleX/scaleY > 1) spills out of the avatar box rather than being
           cropped — the usual Foundry large-creature token look. Omitted for
           out-of-character posts, which have no character token. -->
      <div
        v-if="view.hasPortrait"
        data-part="chat-portrait"
        class="h-12 w-12 flex-none overflow-visible rounded"
      >
        <img
          v-if="view.portrait"
          class="h-full w-full scale-x-(--sx) scale-y-(--sy) object-cover"
          :src="view.portrait"
          :alt="view.speakerName"
          :style="view.portraitScale"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div class="flex min-w-0 flex-col" :class="isOwn ? 'items-end' : 'items-start'">
        <button
          type="button"
          data-part="chat-name-button"
          data-tone="primary"
          class="max-w-full min-w-0 truncate text-left text-base font-semibold text-gray-900"
          @click="emit('selectAuthor')"
        >
          {{ view.speakerName }}
        </button>
        <button
          v-if="!isOwn && view.showAuthorName"
          type="button"
          data-part="chat-name-button"
          data-tone="muted"
          class="max-w-full min-w-0 truncate text-left text-xs text-gray-500"
          @click="emit('selectAuthor')"
        >
          {{ view.authorName }}
        </button>
        <span
          v-if="view.visibilityLabel"
          data-part="visibility"
          class="max-w-full truncate text-xs text-gray-400"
        >
          {{
            view.whisperRecipients.length
              ? $t('chat.whisperTo', { names: view.whisperRecipients.join(', ') })
              : $t(view.visibilityLabel)
          }}
        </span>
      </div>
    </div>

    <!-- Bubble + manage affordance. The row is capped so long runs don't span
         the full width; flex-row-reverse keeps the bubble on the outer edge for
         others so the kebab lands on the inner side for both. -->
    <div
      class="flex max-w-[85%] items-center gap-1"
      :class="isOwn ? 'flex-row' : 'flex-row-reverse'"
    >
      <!-- Edit/delete kebab (own messages). Hidden until the message is hovered
           on pointer devices; always shown (subtly) on touch, which has no
           hover. Its slot is reserved so revealing it never shifts the bubble. -->
      <div
        v-if="canManage"
        data-part="chat-actions"
        class="flex-none text-gray-400 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <KebabMenu :items="menuItems" :label="$t('chat.messageActions')" @select="onMenuSelect" />
      </div>
      <div
        data-part="chat-bubble"
        class="max-w-full min-w-0 px-3 py-2 text-gray-900 transition-shadow"
        :class="[bubbleClass, highlighted ? 'ring-2 ring-amber-400 ring-offset-1' : '']"
      >
        <div
          v-if="view.preparedFlavor"
          data-part="chat-flavor"
          class="mb-1 text-base font-medium text-gray-700"
          v-html="view.preparedFlavor"
          @click="emit('contentClick', $event)"
        />
        <div
          v-if="view.showContent && view.preparedContent"
          data-part="chat-content"
          data-tone="primary"
          class="text-base wrap-break-word text-gray-900"
          v-html="view.preparedContent"
          @click="handleContentClick($event)"
        />
        <!-- Native player for an attached voice memo. Rendered as a real element
           (not via the content v-html) because the chat-HTML sanitizer strips
           <audio>; the URL is resolved from flags.tablemate in useChatMessages. -->
        <div v-if="view.audioUrl" data-part="chat-voice-memo" class="mt-2">
          <audio controls preload="metadata" :src="view.audioUrl" class="w-full" />
          <!-- AI transcript, when one was produced GM-side. Plain text (never HTML)
             so a transcript can't inject markup. -->
          <p
            v-if="view.transcript"
            data-part="chat-voice-memo-transcript"
            class="mt-1 text-sm text-gray-500 italic"
          >
            {{ view.transcript }}
          </p>
        </div>
        <!-- Native image for an attached upload. Rendered as a real element (not via
           the content v-html) — the content copy rides in a [data-tablemate-image]
           wrapper the chat-HTML sanitizer strips, and the URL is resolved from
           flags.tablemate in useChatMessages. Links out to the full-size file. -->
        <div v-if="view.imageUrl" data-part="chat-image" class="mt-2">
          <a :href="view.imageUrl" target="_blank" rel="noreferrer" class="inline-block">
            <img
              :src="view.imageUrl"
              :alt="view.speakerName"
              :width="view.imageWidth"
              :height="view.imageHeight"
              class="max-h-80 max-w-full rounded-md object-contain"
              loading="lazy"
              decoding="async"
            />
          </a>
        </div>
        <div
          v-if="view.inlineChecks.length && actorId"
          data-part="chat-inline-checks"
          class="mt-2 flex flex-wrap gap-1.5"
        >
          <button
            v-for="(check, checkIndex) in view.inlineChecks"
            :key="checkIndex"
            type="button"
            data-part="chat-inline-check-button"
            class="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-100 active:bg-blue-200"
            @pointerdown="triggerLightHapticFeedback()"
            @click="emit('openInlineCheck', check)"
          >
            <img :src="d20Icon" class="h-3.5 w-3.5 flex-none" alt="" aria-hidden="true" />
            {{ inlineCheckLabel(check) }}
          </button>
        </div>
        <div v-if="view.rolls.length" data-part="chat-rolls" class="mt-2 space-y-2">
          <ChatRollCard
            v-for="(roll, rollIndex) in view.rolls"
            :key="`${view.key}-roll-${rollIndex}`"
            :view="view"
            :roll="roll"
            :roll-index="rollIndex"
            :actions="actions"
            @open-reroll="
              (mode) => emit('openReroll', { message: view.message, roll, rollIndex, mode })
            "
          />
        </div>
        <div v-if="view.showEmptyMessage" data-tone="muted" class="text-sm text-gray-500 italic">
          {{ $t('chat.emptyMessage') }}
        </div>
      </div>
    </div>

    <!-- Inline delete confirmation (two-step, no modal). -->
    <div
      v-if="confirmingDelete"
      data-part="chat-delete-confirm"
      class="mt-1 flex items-center gap-3 px-1 text-xs"
      :class="isOwn ? 'flex-row-reverse' : ''"
    >
      <span class="text-gray-500">{{ $t('chat.confirmDelete') }}</span>
      <button type="button" class="font-semibold text-red-600" @click="confirmDelete">
        {{ $t('common.delete') }}
      </button>
      <button type="button" class="text-gray-500" @click="confirmingDelete = false">
        {{ $t('common.cancel') }}
      </button>
    </div>

    <time
      v-if="groupEnd && view.formattedTime"
      data-tone="muted"
      class="mt-0.5 px-1 text-[11px] text-gray-400"
    >
      {{ view.formattedTime }}
    </time>
  </li>
</template>
