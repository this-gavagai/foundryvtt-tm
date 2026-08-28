<script setup lang="ts">
import { computed, ref, watchPostEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatMessageView } from '@/composables/useChatMessages'
import type { ChatActions, ChatRerollRequest } from '@/composables/useChatActions'
import {
  triggerLightHapticFeedback,
  triggerLongPressHapticFeedback
} from '@/composables/useHapticFeedback'
import { useLongPress } from '@/composables/useLongPress'
import { REACTION_EMOJI } from '@/utils/chatReactions'
import ChatRollCard from '@/components/ChatRollCard.vue'
import TokenArt from '@/components/TokenArt.vue'
import { fillUuidLinkLabels } from '@/utils/compendiumNames'
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
  // groupStart draws the gutter token and the name/time line above the run;
  // groupEnd rounds off the last bubble of a run.
  groupStart: boolean
  groupEnd: boolean
  // Whether the connected module supports reactions (capability handshake). A
  // prop rather than a store read: the overlay resolves it once instead of every
  // row in a long log subscribing to the same store.
  reactionsSupported: boolean
}>()

// Label-less @UUID[...] links render as a "…" placeholder because their text is
// the linked document's name, which is only known after reading it (see
// pf2eUuidHtml). PF2e omits the label wherever the two would be equal, so a
// daily-preparations card lists every prepared spell that way. v-html rebuilds
// these subtrees whenever the prepared HTML changes, which restores the
// placeholders, so refill after each render — the pass is idempotent and only
// touches anchors still flagged unresolved.
const flavorRef = ref<HTMLElement>()
const contentRef = ref<HTMLElement>()
watchPostEffect(() => {
  // Read both, so this re-runs when either v-html swaps its subtree.
  void props.view.preparedFlavor
  void props.view.preparedContent
  fillUuidLinkLabels(flavorRef.value)
  fillUuidLinkLabels(contentRef.value)
})

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
  // Long-press on a reaction chip: show who reacted with what. The overlay owns
  // the sheet, like the other modals.
  showReactions: [view: ChatMessageView]
}>()

const { t } = useI18n()

// Right-aligned, tinted bubble for the current user's own messages; left-aligned
// for everyone else. Either side lays out as a Discord-style gutter + body: the
// token sits in the gutter on the sender's side and the name/details line runs
// above the first card of a run, so the sender can see which character (or OOC
// alias) each message was posted as.
const isOwn = computed(() => props.view.isOwnMessage)
const showHeader = computed(() => props.groupStart)

// Edit/delete affordance, own messages only. Edit is offered just for plain-text
// posts (no rolls, voice, image, or reroll card — the only kind that can be
// meaningfully re-typed); delete works on any of the user's own messages.
const canManage = computed(() => isOwn.value && !!props.view.message._id)

// Reactions apply to ANY message, including other people's — that's the point of
// them, and it's why the menu affordance below is no longer own-messages-only.
const canReact = computed(() => props.reactionsSupported && !!props.view.message._id)

// Any reason to offer the menu at all: the reaction palette, the manage items,
// or both.
const hasMenu = computed(() => canReact.value || canManage.value)

// The palette, marked with what this user has already reacted with so a tap on a
// filled pick reads as "remove mine".
const quickPicks = computed(() => {
  if (!canReact.value) return []
  const mine = new Set(props.view.reactions.filter((r) => r.mine).map((r) => r.emoji))
  return REACTION_EMOJI.map((emoji) => ({
    value: emoji,
    label: t('chat.reactWith', { emoji }),
    active: mine.has(emoji)
  }))
})

function toggleReaction(emoji: string) {
  triggerLightHapticFeedback()
  void props.actions.toggleMessageReaction(props.view.message, emoji)
}
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

// A voice memo has no re-typable body, but a transcribed one does have text the
// sender may want to fix — a misheard name, a word the model guessed at. Edit is
// offered for that text specifically: the composer loads the transcript, and
// saving rewrites it in place, leaving the recording itself alone.
const canEditTranscript = computed(
  () => canManage.value && !!props.view.audioUrl && !!props.view.transcript
)
const menuItems = computed(() => {
  const items: { id: string; label: string; danger?: boolean }[] = []
  if (canEdit.value) items.push({ id: 'edit', label: t('chat.edit') })
  else if (canEditTranscript.value) items.push({ id: 'edit', label: t('chat.editTranscript') })
  // Gated like the edit entries: hasMenu opens for a reaction alone, so on
  // someone else's message this menu exists with nothing manageable in it.
  if (canManage.value) items.push({ id: 'delete', label: t('common.delete'), danger: true })
  return items
})

// The overlay owns the composer edit-mode and the delete confirmation modal;
// the row just relays the chosen action.
function onMenuSelect(id: string) {
  if (id === 'edit') emit('edit', props.view)
  else if (id === 'delete') emit('delete', props.view)
}

// Desktop reveals the kebab on hover; touch has no persistent kebab — a
// long-press opens the same menu (anchored to the hidden trigger).
//
// This used to be gated to own messages so that others' bubbles kept native
// press-and-hold (text selection / callout). Reactions apply to every message,
// so the gesture now has a purpose everywhere and the native callout is
// suppressed on every bubble — a deliberate trade: one gesture that always does
// the same thing beats keeping text selection on half the log.
//
// Both long-presses tick a haptic as they fire: a held gesture has no visible
// state until the menu or sheet appears, so the thump is the only signal that
// the hold took. It plays before opening so the confirmation lands at the moment
// the press registers, not after the animation.
const kebab = ref<InstanceType<typeof KebabMenu>>()
const longPress = useLongPress(
  () => {
    triggerLongPressHapticFeedback()
    kebab.value?.openMenu()
  },
  {
    enabled: () => hasMenu.value
  }
)

// Long-press a reaction chip to see who reacted with what. Touch-only by
// construction (useLongPress ignores mouse/pen), which is exactly the gap it
// fills: on a pointer device the chip's title tooltip already shows the same
// list on hover, but a tooltip can never render on touch.
//
// A separate useLongPress instance from the bubble's — each press records its own
// target element, and the release-burst suppression is scoped to that element.
// That's what keeps the lift at the end of a long-press from also firing the
// chip's click and toggling the reaction the user was only inspecting.
const reactionLongPress = useLongPress(
  () => {
    triggerLongPressHapticFeedback()
    emit('showReactions', props.view)
  },
  {
    enabled: () => props.view.reactions.length > 0
  }
)

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
  <!-- data-own-message and data-own-actor are deliberately separate. The first
       is about the USER who posted and drives the bubble's own-vs-other look.
       The second is about the ACTOR the message acts on, and is what decides
       whether a Foundry chat card's owner buttons (attack, damage, variant,
       consume) can do anything: with a shared login, the sheet in front of you
       may not be the character the card names. See the card-button rules in
       main.css. -->
  <li
    data-part="chat-message"
    class="group flex items-start gap-2"
    :class="[isOwn ? 'flex-row-reverse' : 'flex-row', groupStart ? 'mt-4' : 'mt-0.5']"
    :data-message-id="view.message._id ?? undefined"
    :data-message-type="view.message.type"
    :data-private="!!view.visibilityLabel"
    :data-own-message="isOwn"
    :data-own-actor="view.isOwnActor"
    :data-unread="unread || undefined"
  >
    <!-- Gutter: the speaker's token, drawn once at the top of a run and sitting
         on the sender's side (flex-row-reverse puts it on the right for own
         messages). It holds its width on continuation rows — and on
         out-of-character posts, which have no token — so every bubble in a run
         shares one edge, the way Discord's mobile log does.

         overflow-visible so a token whose art is scaled past its frame
         (scaleX/scaleY > 1) spills out of the avatar box rather than being
         cropped — the usual Foundry large-creature token look. A ring token
         brings its own round clip instead (see TokenArt). -->
    <div data-part="chat-gutter" class="w-10 flex-none">
      <div
        v-if="showHeader && view.hasPortrait"
        data-part="chat-portrait"
        class="h-10 w-10 overflow-visible rounded"
      >
        <TokenArt
          v-if="view.portrait"
          :url="view.portrait"
          :scaleX="view.portraitScale['--sx']"
          :scaleY="view.portraitScale['--sy']"
          :ring="view.portraitRing"
          :px="40"
          objectFit="cover"
          lazy
          :alt="view.speakerName"
        />
      </div>
    </div>

    <!-- Body column: the run's name/time header and its cards (each carrying its
         own reaction chips), aligned to the sender's side. -->
    <div class="flex min-w-0 flex-1 flex-col" :class="isOwn ? 'items-end' : 'items-start'">
      <!-- Name/details line: the Discord-mobile header, above the first
           card of a run — the character (or OOC alias) name, the player
           behind it, any whisper label, and the time. Reversed for own
           messages so the name sits nearest its gutter token. -->
      <div
        v-if="showHeader"
        data-part="chat-header"
        class="mb-1 flex max-w-full flex-wrap items-baseline gap-x-2"
        :class="isOwn ? 'flex-row-reverse' : ''"
      >
        <button
          type="button"
          data-part="chat-name-button"
          data-tone="primary"
          class="min-w-0 truncate text-left text-base font-semibold text-gray-900"
          @pointerdown="triggerLightHapticFeedback()"
          @click="emit('selectAuthor')"
        >
          {{ view.speakerName }}
        </button>
        <button
          v-if="!isOwn && view.showAuthorName"
          type="button"
          data-part="chat-name-button"
          data-tone="muted"
          class="min-w-0 truncate text-left text-xs text-gray-500"
          @pointerdown="triggerLightHapticFeedback()"
          @click="emit('selectAuthor')"
        >
          {{ view.authorName }}
        </button>
        <span
          v-if="view.visibilityLabel"
          data-part="visibility"
          class="truncate text-xs text-gray-400"
        >
          {{
            view.whisperRecipients.length
              ? $t('chat.whisperTo', { names: view.whisperRecipients.join(', ') })
              : $t(view.visibilityLabel)
          }}
        </span>
        <time
          v-if="view.formattedTime"
          data-tone="muted"
          class="text-[11px] whitespace-nowrap text-gray-400"
        >
          {{ view.formattedTime }}
        </time>
      </div>
      <!-- Bubble + manage affordance. A relative wrapper, capped so long runs don't
           span the full width; the kebab is absolutely positioned on the inner side
           (below) so it never affects the bubble's width. On touch a long-press
           opens the menu (the kebab stays hidden), and selection/callout is
           suppressed on own bubbles there so the press doesn't also start a text
           selection. -->
      <div
        class="relative min-w-0"
        :class="[
          // A voice memo's <audio> has no intrinsic width, so a shrink-to-fit
          // bubble would collapse it to just the play button — force those bubbles
          // to the full bubble width so the player gets its scrubber. Text/other
          // content still hugs its content up to the same cap.
          view.audioUrl ? 'w-full max-w-[85%]' : 'max-w-[85%]',
          hasMenu
            ? '[@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]'
            : ''
        ]"
      >
        <!-- Long-press handlers live on the bubble (not this wrapper) so the
             kebab — a sibling below — is outside the click guard; otherwise the
             guard would swallow the programmatic click that opens the menu. -->
        <div
          data-part="chat-bubble"
          class="max-w-full min-w-0 px-3 py-2 text-gray-900 transition-shadow"
          :class="[bubbleClass, highlighted ? 'ring-2 ring-amber-400 ring-offset-1' : '']"
          @pointerdown="longPress.onPointerdown"
          @pointermove="longPress.onPointermove"
          @pointerup="longPress.onPointerup"
          @pointercancel="longPress.onPointercancel"
        >
          <div
            v-if="view.preparedFlavor"
            ref="flavorRef"
            data-part="chat-flavor"
            class="mb-1 text-base font-medium text-gray-700"
            v-html="view.preparedFlavor"
            @click="emit('contentClick', $event)"
          />
          <div
            v-if="view.showContent && view.preparedContent"
            ref="contentRef"
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
               so a transcript can't inject markup.

               A data-tone is required for themes to recolor this at all — without
               one it kept the light-theme gray-500 fallback on the dark themes,
               where it was too faint to read against the reskinned bubble.
               Deliberately "primary" rather than the "muted" the byline and
               timestamp use: muted resolves to L 62% against bubbles at L 26%/33%
               (~3.6:1 and ~2.7:1, both under AA) — barely better than the gray-500
               it replaced. It is also the wrong semantics. A transcript IS the
               content of a voice memo, not a decoration around it, so it takes the
               full text color and lets italic + the smaller size carry the
               hierarchy. -->
            <p
              v-if="view.transcript"
              data-part="chat-voice-memo-transcript"
              data-tone="primary"
              class="mt-1 text-sm whitespace-pre-line text-gray-500 italic"
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
          <!-- Reaction chips, in the card under the message they belong to, aligned
               to the sender's side so a run of own messages keeps its right edge.
               A tap on a chip toggles this user's own reaction of that emoji — the
               same operation as picking it from the palette; a long-press shows who
               reacted. Selection/callout is suppressed on touch so the long-press
               doesn't also start selecting the chip's count text.

               pointerdown stops here: the bubble around these chips runs its own
               long-press (the message menu), and without this a held chip would
               start both timers and fire both gestures at once. -->
          <ul
            v-if="view.reactions.length"
            data-part="chat-reactions"
            class="mt-2 flex max-w-full flex-wrap gap-1 [@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]"
            :class="isOwn ? 'justify-end' : 'justify-start'"
            @pointerdown.stop
          >
            <li v-for="group in view.reactions" :key="group.emoji">
              <button
                type="button"
                data-part="chat-reaction-chip"
                :data-emoji="group.emoji"
                :data-mine="group.mine || undefined"
                :disabled="!canReact || actions.isReactionPending(view.message._id, group.emoji)"
                class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-60"
                :class="
                  group.mine
                    ? 'border-blue-400 bg-blue-200 font-semibold text-blue-900'
                    : 'border-gray-300 bg-white text-gray-700'
                "
                :aria-label="
                  $t('chat.reactedBy', { emoji: group.emoji, names: group.names.join(', ') })
                "
                :title="$t('chat.reactedBy', { emoji: group.emoji, names: group.names.join(', ') })"
                :aria-pressed="group.mine"
                @click="toggleReaction(group.emoji)"
                @pointerdown="reactionLongPress.onPointerdown"
                @pointermove="reactionLongPress.onPointermove"
                @pointerup="reactionLongPress.onPointerup"
                @pointercancel="reactionLongPress.onPointercancel"
              >
                <span aria-hidden="true">{{ group.emoji }}</span>
                <span>{{ group.count }}</span>
              </button>
            </li>
          </ul>
        </div>
        <!-- Message menu: the reaction palette (any message) plus edit/delete (own
             messages). Absolutely positioned on the inner side so it never affects
             the bubble width. Revealed on hover on pointer devices; on touch it
             stays hidden and inert — a long-press opens the menu, anchored here.
             The focus-within half of the reveal is scoped to hover-capable devices
             so it serves keyboard users (Tab to the kebab, see it) without firing
             on touch: Headless UI restores focus to the trigger when the menu
             closes, and with no hover state to lose the dots would then stay
             visible on the row the long-press had just acted on. -->
        <div
          v-if="hasMenu"
          data-part="chat-actions"
          class="pointer-events-none absolute top-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:pointer-events-auto [@media(hover:hover)]:group-focus-within:opacity-100"
          :class="isOwn ? 'right-full mr-1' : 'left-full ml-1'"
        >
          <KebabMenu
            ref="kebab"
            :items="menuItems"
            :quick-picks="quickPicks"
            :label="canManage ? $t('chat.messageActions') : $t('chat.addReaction')"
            @select="onMenuSelect"
            @quick-pick="toggleReaction($event)"
          />
        </div>
      </div>
    </div>
  </li>
</template>
