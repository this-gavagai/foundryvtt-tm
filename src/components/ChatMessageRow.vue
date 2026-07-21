<script setup lang="ts">
import type { ChatMessageView } from '@/composables/useChatMessages'
import type { ChatActions, ChatRerollRequest } from '@/composables/useChatActions'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import ChatRollCard from '@/components/ChatRollCard.vue'
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
}>()

const emit = defineEmits<{
  // Tapping a name preselects that user as the whisper recipient.
  selectAuthor: []
  // Clicks inside Foundry-rendered HTML (compendium links, inline rolls) — the
  // overlay owns the modals those open.
  contentClick: [event: MouseEvent]
  openInlineCheck: [check: ActiveRoll]
  openReroll: [request: ChatRerollRequest]
}>()

function handleContentClick(event: MouseEvent) {
  emit('contentClick', event)
  props.actions.handleCardButtonClick(event)
}
</script>

<template>
  <li
    data-part="chat-message"
    class="rounded-md border p-3 transition-shadow"
    :class="[
      unread ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50',
      highlighted ? 'ring-2 ring-amber-400 ring-offset-1' : ''
    ]"
    :data-message-id="view.message._id ?? undefined"
    :data-message-type="view.message.type"
    :data-private="!!view.visibilityLabel"
    :data-own-message="view.isOwnActor"
    :data-unread="unread || undefined"
  >
    <div class="flex gap-3">
      <div
        v-if="view.hasPortrait"
        data-part="chat-portrait"
        class="h-12 w-12 flex-none overflow-hidden overflow-visible rounded"
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
      <div class="min-w-0 flex-1">
        <div class="flex gap-2">
          <div class="min-w-0 flex-1">
            <button
              type="button"
              data-part="chat-name-button"
              data-tone="primary"
              class="block max-w-full truncate text-left font-semibold text-gray-900"
              @click="emit('selectAuthor')"
            >
              {{ view.speakerName }}
            </button>
            <button
              v-if="view.showAuthorName"
              type="button"
              data-part="chat-name-button"
              data-tone="muted"
              class="block max-w-full truncate text-left text-xs text-gray-500"
              @click="emit('selectAuthor')"
            >
              {{ view.authorName }}
            </button>
          </div>
          <span
            v-if="view.visibilityLabel"
            data-part="visibility"
            class="mt-0.5 self-start text-xs"
          >
            {{
              view.whisperRecipients.length
                ? $t('chat.whisperTo', { names: view.whisperRecipients.join(', ') })
                : $t(view.visibilityLabel)
            }}
          </span>
          <time v-if="view.formattedTime" data-tone="muted" class="ml-auto text-xs text-gray-500">
            {{ view.formattedTime }}
          </time>
        </div>
      </div>
    </div>
    <div
      v-if="view.preparedFlavor"
      data-part="chat-flavor"
      class="mt-2 mb-2 text-sm font-medium text-gray-700"
      v-html="view.preparedFlavor"
      @click="emit('contentClick', $event)"
    />
    <div
      v-if="view.showContent"
      data-part="chat-content"
      data-tone="primary"
      class="mt-2 text-sm text-gray-900"
      v-html="view.preparedContent"
      @click="handleContentClick($event)"
    />
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
    <div v-if="view.showEmptyMessage" data-tone="muted" class="mt-2 text-sm text-gray-500 italic">
      {{ $t('chat.emptyMessage') }}
    </div>
  </li>
</template>
