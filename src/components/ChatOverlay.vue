<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import {
  TransitionRoot,
  TransitionChild,
  Dialog,
  DialogPanel,
  DialogTitle,
  Menu,
  MenuButton,
  MenuItems,
  MenuItem
} from '@headlessui/vue'
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  PaperAirplaneIcon,
  XMarkIcon
} from '@heroicons/vue/24/outline'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useOverlayStack } from '@/composables/useOverlayStack'
import { useChatStore } from '@/stores/chat'
import { useWorldStore } from '@/stores/world'
import { useChatActions } from '@/composables/useChatActions'
import {
  messageIsReroll,
  useChatMessages,
  type ChatMessageView,
  type ChatMessageData
} from '@/composables/useChatMessages'
import { collectionToArray, type CollectionLike } from '@/composables/chatCollections'
import type { UserData } from '@/composables/useChatVisibility'
import ChatInlineRollModal from '@/components/ChatInlineRollModal.vue'
import CompendiumItemModal from '@/components/CompendiumItemModal.vue'
import InfoModal from '@/components/InfoModal.vue'
import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'
import {
  activeRollFromFoundryClickTarget,
  compendiumItemUuidFromClickTarget
} from '@/utils/foundryHtml'
import type { ActiveRoll, ChatRollRerollMode } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import type { ChatRollDie, ChatRollSummary } from '@/utils/chatRollSummary'

const isOpen = ref(false)
const scrollContainer = ref<HTMLElement>()
const chatInput = ref<HTMLTextAreaElement>()
const { zIndex, openLayer, closeLayer } = useOverlayStack()
const character = useInjectedCharacter()
const { _id, _actor, shield, skills, saves, perception } = character
const inlineRollModal = ref<InstanceType<typeof ChatInlineRollModal>>()
const compendiumModal = ref<InstanceType<typeof CompendiumItemModal>>()
const rerollModal = ref<InstanceType<typeof InfoModal>>()
const activeReroll = ref<{
  message: ChatMessageData
  roll: ChatRollSummary
  rollIndex: number
  mode: ChatRollRerollMode
}>()
const { t } = useI18n()
let scrollAnimationFrame: number | undefined

interface WhisperUserData extends UserData {
  role?: number
}

interface WhisperTarget {
  key: string
  label: string
  commandTarget?: string
  userIds?: string[]
}

const PUBLIC_WHISPER_TARGET = 'public'
const GMS_WHISPER_TARGET = 'gms'
type WhisperSelectionMode = typeof PUBLIC_WHISPER_TARGET | typeof GMS_WHISPER_TARGET | 'users'

const dieIcons: Record<number, string> = {
  4: d4Icon,
  6: d6Icon,
  8: d8Icon,
  10: d10Icon,
  12: d12Icon,
  20: d20Icon,
  100: d10Icon
}

function rollKindLabel(roll: ChatRollSummary): string {
  if (roll.className === 'DamageRoll') return 'Damage'
  if (roll.className === 'CheckRoll') return 'Check'
  return roll.className?.replace(/Roll$/, '') || 'Roll'
}

function rollDisplayText(value: string): string {
  return value.replace(/[{}]/g, '')
}

function rollFormulaLabel(roll: ChatRollSummary): string {
  return roll.formula ? rollDisplayText(roll.formula) : ''
}

function rollDieLabel(die: ChatRollDie): string {
  const results = die.results.length ? `: ${die.results.join(', ')}` : ''
  return `${rollDisplayText(die.formula)}${results}`
}

function rollDieIcon(die: ChatRollDie): string {
  return dieIcons[die.faces ?? 0] ?? d20Icon
}

function rollFlavorLabel(roll: ChatRollSummary): string {
  return roll.flavors.length ? ` [${roll.flavors.map(rollDisplayText).join(', ')}]` : ''
}

function rerollLabelKey(mode: ChatRollRerollMode): string {
  switch (mode) {
    case 'hero-point':
      return 'chat.heroPointReroll'
    case 'keep-highest':
      return 'chat.rerollKeepHighest'
    case 'keep-lowest':
      return 'chat.rerollKeepLowest'
    case 'reroll':
    default:
      return 'chat.reroll'
  }
}

const { messages, renderedMessages, messageIsOwnActor } = useChatMessages(_id)

const chatStore = useChatStore()
const { world } = storeToRefs(useWorldStore())

const selectedWhisperMode = ref<WhisperSelectionMode>(PUBLIC_WHISPER_TARGET)
const selectedWhisperUserKeys = ref(new Set<string>())

const whisperGroupTargets = computed<WhisperTarget[]>(() => [
  { key: PUBLIC_WHISPER_TARGET, label: t('chat.everyone') },
  { key: GMS_WHISPER_TARGET, label: t('chat.gms'), commandTarget: 'gm' }
])

const whisperUserTargets = computed<WhisperTarget[]>(() => {
  const currentUserId = (world.value as { userId?: string } | undefined)?.userId
  return collectionToArray<WhisperUserData>(world.value?.users as CollectionLike<WhisperUserData>)
    .filter((user) => {
      const id = user._id ?? user.id
      return !!user.name && id !== currentUserId
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map((user) => ({
      key: `user:${user._id ?? user.id ?? user.name}`,
      label: user.name ?? '',
      commandTarget: `[${user.name}]`,
      userIds: [user._id, user.id].filter((id): id is string => !!id)
    }))
})

const selectedWhisperUserTargets = computed(() =>
  whisperUserTargets.value.filter((target) => selectedWhisperUserKeys.value.has(target.key))
)

const selectedWhisperCommandTargets = computed(() => {
  if (selectedWhisperMode.value === GMS_WHISPER_TARGET) return ['gm']
  if (selectedWhisperMode.value !== 'users') return []
  return selectedWhisperUserTargets.value
    .map((target) => target.commandTarget)
    .filter((target): target is string => !!target)
})

const selectedWhisperLabel = computed(() => {
  if (selectedWhisperMode.value === GMS_WHISPER_TARGET) return t('chat.gms')
  if (selectedWhisperMode.value !== 'users') return t('chat.everyone')
  return selectedWhisperUserTargets.value.map((target) => target.label).join(', ')
})

function selectWhisperGroup(key: typeof PUBLIC_WHISPER_TARGET | typeof GMS_WHISPER_TARGET) {
  selectedWhisperMode.value = key
  selectedWhisperUserKeys.value = new Set()
}

function toggleWhisperUser(key: string) {
  const next = new Set(selectedWhisperUserKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedWhisperUserKeys.value = next
  selectedWhisperMode.value = next.size ? 'users' : PUBLIC_WHISPER_TARGET
}

function userTargetSelected(key: string): boolean {
  return selectedWhisperMode.value === 'users' && selectedWhisperUserKeys.value.has(key)
}

function messageAuthorIds(message: ChatMessageData): Set<string> {
  const ids = new Set<string>()
  const tablemateOrigin =
    message.flags?.tablemate?.originUserId ?? message['flags.tablemate.originUserId']
  if (typeof tablemateOrigin === 'string' && tablemateOrigin) ids.add(tablemateOrigin)
  if (typeof message.author === 'string' && message.author) ids.add(message.author)
  if (typeof message.author === 'object' && message.author?._id) ids.add(message.author._id)
  if (message.user) ids.add(message.user)
  return ids
}

function selectWhisperUserFromMessage(view: ChatMessageView) {
  const authorIds = messageAuthorIds(view.message)
  const nameCandidates = new Set([view.authorName, view.speakerName].filter(Boolean))
  const target = whisperUserTargets.value.find(
    (userTarget) =>
      userTarget.userIds?.some((id) => authorIds.has(id)) || nameCandidates.has(userTarget.label)
  )
  if (!target) return
  selectedWhisperMode.value = 'users'
  selectedWhisperUserKeys.value = new Set([target.key])
}

function whisperContent(content: string): string {
  const targets = selectedWhisperCommandTargets.value
  if (!targets.length) return content
  return `/w ${targets.join(', ')} ${content}`
}

function submitChatMessage() {
  const content = draft.value.trim()
  if (!content) return
  submitMessage(whisperContent(content))
}

// Key of the first message that falls below the frozen "new messages" divider,
// so the template can render the separator immediately before that row.
const firstUnreadKey = computed(
  () => renderedMessages.value.find((view) => chatStore.isUnread(view.message))?.key ?? null
)

// Whether the scroll position is at (or within a hair of) the newest message.
// Drives two things: marking everything read once the user reaches the bottom,
// and only auto-following new arrivals when they're already there (so a user
// reading up at the divider isn't yanked down).
const isAtBottom = ref(true)
function updateAtBottom() {
  const el = scrollContainer.value
  if (!el) {
    isAtBottom.value = true
    return
  }
  isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48
}
function onScroll() {
  updateAtBottom()
  if (isAtBottom.value) chatStore.markAllRead()
}

// On open, land the user where they left off: scroll the first unread row just
// below the top edge if there is one, otherwise jump to the bottom as before.
function positionOnOpen() {
  nextTick(() => {
    const el = scrollContainer.value
    if (!el) return
    const target = el.querySelector<HTMLElement>('[data-first-unread]')
    // offsetTop (vs getBoundingClientRect) is layout-based, so it stays correct
    // even while the dialog's enter transition is mid-scale. The scroll
    // container is `relative`, so this is the divider's offset within it.
    el.scrollTop = target
      ? Math.max(0, target.offsetTop - 12)
      : Math.max(0, el.scrollHeight - el.clientHeight)
    // Run the same at-bottom check a real scroll would: when the whole log fits
    // in view (e.g. a single message) there's no scroll event to fire it, so the
    // unread badge would otherwise never clear.
    onScroll()
  })
}

const {
  draft,
  isSending,
  sendError,
  actionError,
  canSend,
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
} = useChatActions({
  actorId: _id,
  actor: _actor,
  shield,
  messages,
  messageIsOwnActor,
  onMessageSent: () => {
    scrollToBottom(true)
    // Return focus to the composer for rapid follow-up messages. Deferred to
    // nextTick so it runs after the textarea's `:disabled` (isSending) clears
    // on the post-send flush — focusing a disabled element is a no-op.
    nextTick(() => chatInput.value?.focus())
  }
})

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

function openRerollModal(
  message: ChatMessageData,
  roll: ChatRollSummary,
  rollIndex: number,
  mode: ChatRollRerollMode
) {
  if (!canTriggerRollAction(message, roll, rollIndex, mode)) return
  activeReroll.value = { message, roll, rollIndex, mode }
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
  const localizedName = (check.slug && checkSlugLabels.value[check.slug]) || check.slug || ''
  const dcSuffix = check.dc ? ` DC ${check.dc}` : check.against ? ` vs ${check.against}` : ''
  return `${localizedName} Check${dcSuffix}`
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
  // Freeze the divider at the current read position before the list paints, so
  // the "new messages" separator marks where the user left off.
  chatStore.beginSession()
  isOpen.value = true
}

function close() {
  isOpen.value = false
  closeLayer()
}

function scrollToBottom(smooth = false) {
  nextTick(() => {
    const el = scrollContainer.value
    if (!el) return

    if (scrollAnimationFrame !== undefined) {
      window.cancelAnimationFrame(scrollAnimationFrame)
      scrollAnimationFrame = undefined
    }

    const target = () => Math.max(0, el.scrollHeight - el.clientHeight)
    if (!smooth) {
      el.scrollTop = target()
      return
    }

    const start = el.scrollTop
    const duration = 180
    const startedAt = performance.now()
    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      el.scrollTop = start + (target() - start) * eased
      if (progress < 1) {
        scrollAnimationFrame = window.requestAnimationFrame(animate)
      } else {
        scrollAnimationFrame = undefined
      }
    }

    scrollAnimationFrame = window.requestAnimationFrame(animate)
  })
}

onBeforeUnmount(() => {
  if (scrollAnimationFrame !== undefined) window.cancelAnimationFrame(scrollAnimationFrame)
  closeLayer()
})

watch(
  () => isOpen.value,
  (openNow) => {
    if (openNow) positionOnOpen()
  }
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

watch(whisperUserTargets, (targets) => {
  const availableKeys = new Set(targets.map((target) => target.key))
  const next = new Set([...selectedWhisperUserKeys.value].filter((key) => availableKeys.has(key)))
  if (next.size !== selectedWhisperUserKeys.value.size) {
    selectedWhisperUserKeys.value = next
  }
  if (selectedWhisperMode.value === 'users' && !next.size) {
    selectedWhisperMode.value = PUBLIC_WHISPER_TARGET
  }
})

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

      <div class="fixed inset-0 overflow-hidden p-0 sm:p-4">
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
                    <li
                      data-part="chat-message"
                      class="rounded-md border p-3"
                      :class="
                        chatStore.isUnread(view.message)
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 bg-gray-50'
                      "
                      :data-message-id="view.message._id ?? undefined"
                      :data-message-type="view.message.type"
                      :data-private="!!view.visibilityLabel"
                      :data-own-message="view.isOwnActor"
                      :data-unread="chatStore.isUnread(view.message) || undefined"
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
                                class="block max-w-full truncate text-left font-semibold text-gray-900"
                                @click="selectWhisperUserFromMessage(view)"
                              >
                                {{ view.speakerName }}
                              </button>
                              <button
                                v-if="view.showAuthorName"
                                type="button"
                                data-part="chat-name-button"
                                class="block max-w-full truncate text-left text-xs text-gray-500"
                                @click="selectWhisperUserFromMessage(view)"
                              >
                                {{ view.authorName }}
                              </button>
                            </div>
                            <span
                              v-if="view.visibilityLabel"
                              data-part="visibility"
                              class="mt-0.5 self-start text-xs"
                            >
                              {{ $t(view.visibilityLabel) }}
                            </span>
                            <time v-if="view.formattedTime" class="ml-auto text-xs text-gray-500">
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
                        @click="handleChatContentClick($event)"
                      />
                      <div
                        v-if="view.showContent"
                        data-part="chat-content"
                        class="mt-2 text-sm text-gray-900"
                        v-html="view.preparedContent"
                        @click="(handleChatContentClick($event), handleCardButtonClick($event))"
                      />
                      <div
                        v-if="view.inlineChecks.length && _id"
                        data-part="chat-inline-checks"
                        class="mt-2 flex flex-wrap gap-1.5"
                      >
                        <button
                          v-for="(check, checkIndex) in view.inlineChecks"
                          :key="checkIndex"
                          type="button"
                          data-part="chat-inline-check-button"
                          class="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-100 active:bg-blue-200"
                          @click="openLocalizedInlineRoll(check)"
                        >
                          <img
                            :src="d20Icon"
                            class="h-3.5 w-3.5 flex-none"
                            alt=""
                            aria-hidden="true"
                          />
                          {{ inlineCheckLabel(check) }}
                        </button>
                      </div>
                      <div v-if="view.rolls.length" data-part="chat-rolls" class="mt-2 space-y-2">
                        <div
                          v-for="(roll, rollIndex) in view.rolls"
                          :key="`${view.key}-roll-${rollIndex}`"
                          data-part="chat-roll"
                          class="relative rounded border border-gray-200 bg-white px-3 py-2 text-sm"
                          :class="messageIsReroll(view.message) ? 'pr-24' : 'pr-10'"
                        >
                          <span
                            v-if="messageIsReroll(view.message)"
                            data-part="chat-rerolled-label"
                            class="absolute top-2 right-2 text-xs font-semibold tracking-wide uppercase"
                          >
                            REROLLED
                          </span>
                          <Menu
                            v-else-if="canReroll(view.message, roll)"
                            as="div"
                            data-part="chat-roll-menu"
                            class="absolute top-1.5 right-1.5"
                          >
                            <MenuButton
                              type="button"
                              data-part="chat-roll-menu-button"
                              class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                              :aria-label="$t('chat.rollActions')"
                              :aria-busy="isRollActionPending(view.message, rollIndex)"
                            >
                              <EllipsisVerticalIcon class="h-5 w-5" aria-hidden="true" />
                            </MenuButton>
                            <MenuItems
                              data-part="chat-roll-menu-items"
                              class="absolute right-0 z-20 mt-1 w-48 rounded-md border border-gray-200 bg-white py-1 text-xs font-semibold text-gray-700 shadow-lg ring-1 ring-black/5 focus:outline-hidden"
                            >
                              <MenuItem v-slot="{ active }">
                                <button
                                  type="button"
                                  data-action="hero-point-reroll"
                                  data-part="chat-roll-menu-item"
                                  class="block w-full px-3 py-2 text-left text-amber-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                  :data-active="active ? true : undefined"
                                  :class="active ? 'bg-amber-50' : ''"
                                  :disabled="
                                    !canTriggerRollAction(
                                      view.message,
                                      roll,
                                      rollIndex,
                                      'hero-point'
                                    )
                                  "
                                  :aria-busy="isRollActionPending(view.message, rollIndex)"
                                  @click="
                                    openRerollModal(view.message, roll, rollIndex, 'hero-point')
                                  "
                                >
                                  {{ $t('chat.heroPointReroll') }}
                                </button>
                              </MenuItem>
                              <MenuItem v-slot="{ active }">
                                <button
                                  type="button"
                                  data-action="reroll"
                                  data-part="chat-roll-menu-item"
                                  class="block w-full px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                  :data-active="active ? true : undefined"
                                  :class="active ? 'bg-gray-100 text-gray-900' : ''"
                                  :disabled="
                                    !canTriggerRollAction(view.message, roll, rollIndex, 'reroll')
                                  "
                                  :aria-busy="isRollActionPending(view.message, rollIndex)"
                                  @click="openRerollModal(view.message, roll, rollIndex, 'reroll')"
                                >
                                  {{ $t('chat.reroll') }}
                                </button>
                              </MenuItem>
                              <MenuItem v-slot="{ active }">
                                <button
                                  type="button"
                                  data-action="reroll-keep-highest"
                                  data-part="chat-roll-menu-item"
                                  class="block w-full px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                  :data-active="active ? true : undefined"
                                  :class="active ? 'bg-gray-100 text-gray-900' : ''"
                                  :disabled="
                                    !canTriggerRollAction(
                                      view.message,
                                      roll,
                                      rollIndex,
                                      'keep-highest'
                                    )
                                  "
                                  :aria-busy="isRollActionPending(view.message, rollIndex)"
                                  @click="
                                    openRerollModal(view.message, roll, rollIndex, 'keep-highest')
                                  "
                                >
                                  {{ $t('chat.rerollKeepHighest') }}
                                </button>
                              </MenuItem>
                              <MenuItem v-slot="{ active }">
                                <button
                                  type="button"
                                  data-action="reroll-keep-lowest"
                                  data-part="chat-roll-menu-item"
                                  class="block w-full px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                  :data-active="active ? true : undefined"
                                  :class="active ? 'bg-gray-100 text-gray-900' : ''"
                                  :disabled="
                                    !canTriggerRollAction(
                                      view.message,
                                      roll,
                                      rollIndex,
                                      'keep-lowest'
                                    )
                                  "
                                  :aria-busy="isRollActionPending(view.message, rollIndex)"
                                  @click="
                                    openRerollModal(view.message, roll, rollIndex, 'keep-lowest')
                                  "
                                >
                                  {{ $t('chat.rerollKeepLowest') }}
                                </button>
                              </MenuItem>
                            </MenuItems>
                          </Menu>
                          <div
                            v-if="view.rerollSummary?.formula || roll.formula || roll.dice.length"
                            data-part="chat-roll-details"
                            class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-gray-500"
                          >
                            <span
                              v-if="view.rerollSummary?.formula || roll.formula"
                              data-part="chat-roll-formula"
                              class="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 break-words text-gray-600"
                            >
                              {{
                                view.rerollSummary?.formula
                                  ? rollDisplayText(view.rerollSummary.formula)
                                  : rollFormulaLabel(roll)
                              }}
                            </span>
                            <span
                              v-if="view.rerollSummary || roll.dice.length"
                              data-part="chat-roll-dice"
                              class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
                            >
                              <template v-if="view.rerollSummary">
                                <span
                                  data-part="chat-roll-die"
                                  class="inline-flex items-center gap-1 leading-none text-gray-500"
                                >
                                  <img
                                    :src="d20Icon"
                                    class="h-4 w-4 opacity-45"
                                    alt=""
                                    aria-hidden="true"
                                  />
                                  <span
                                    :class="
                                      view.rerollSummary.oldDiscarded
                                        ? 'line-through opacity-60'
                                        : ''
                                    "
                                  >
                                    {{ view.rerollSummary.oldDie }}
                                  </span>
                                </span>
                                <span data-part="chat-reroll-arrow">-&gt;</span>
                                <span
                                  data-part="chat-roll-die"
                                  class="inline-flex items-center gap-1 leading-none text-gray-500"
                                >
                                  <img
                                    :src="d20Icon"
                                    class="h-4 w-4 opacity-45"
                                    alt=""
                                    aria-hidden="true"
                                  />
                                  <span
                                    :class="
                                      view.rerollSummary.newDiscarded
                                        ? 'line-through opacity-60'
                                        : ''
                                    "
                                  >
                                    {{ view.rerollSummary.newDie }}
                                  </span>
                                </span>
                              </template>
                              <template v-for="(die, dieIndex) in roll.dice" v-else :key="dieIndex">
                                <template v-if="die.results.length">
                                  <span
                                    v-for="(result, resultIndex) in die.results"
                                    :key="resultIndex"
                                    data-part="chat-roll-die"
                                    class="inline-flex items-center gap-1 leading-none text-gray-500"
                                    :title="rollDieLabel(die)"
                                  >
                                    <img
                                      :src="rollDieIcon(die)"
                                      class="h-4 w-4 opacity-45"
                                      alt=""
                                      aria-hidden="true"
                                    />
                                    <span>{{ result }}</span>
                                  </span>
                                </template>
                                <span
                                  v-else
                                  data-part="chat-roll-die"
                                  class="inline-flex items-center leading-none text-gray-500"
                                  :title="rollDieLabel(die)"
                                >
                                  <img
                                    :src="rollDieIcon(die)"
                                    class="h-4 w-4 opacity-45"
                                    alt=""
                                    aria-hidden="true"
                                  />
                                </span>
                              </template>
                            </span>
                          </div>
                          <div class="mt-2 flex flex-wrap items-baseline gap-1.5">
                            <span
                              class="text-xs font-semibold tracking-wide text-gray-500 uppercase"
                            >
                              {{ rollKindLabel(roll) }}
                            </span>
                            <span
                              v-if="view.rerollSummary"
                              data-part="chat-reroll-total"
                              class="inline-flex items-baseline gap-1.5 text-base font-semibold"
                            >
                              <span
                                :class="
                                  view.rerollSummary.oldDiscarded ? 'line-through opacity-60' : ''
                                "
                              >
                                {{ view.rerollSummary.oldTotal }}
                              </span>
                              <span data-part="chat-reroll-arrow">-&gt;</span>
                              <span
                                :class="
                                  view.rerollSummary.newDiscarded ? 'line-through opacity-60' : ''
                                "
                              >
                                {{ view.rerollSummary.newTotal }}
                              </span>
                            </span>
                            <span
                              v-else-if="roll.total !== undefined"
                              class="text-base font-semibold"
                            >
                              {{ roll.total }}
                            </span>
                            <span
                              v-if="roll.flavors.length"
                              data-part="chat-roll-flavor"
                              class="min-w-0 text-xs break-words text-gray-500"
                            >
                              {{ rollFlavorLabel(roll) }}
                            </span>
                          </div>
                          <div
                            v-if="canApplyDamage(roll)"
                            data-part="chat-damage-actions"
                            class="mt-2 flex flex-wrap gap-1.5"
                          >
                            <button
                              v-if="roll.isHealing"
                              type="button"
                              data-action="heal"
                              class="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 active:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                              :disabled="
                                !canTriggerDamageAction(view.message, roll, rollIndex, 'heal')
                              "
                              :aria-busy="isDamageActionPending(view.message, rollIndex)"
                              @click="applyDamageRoll(view.message, roll, rollIndex, 'heal')"
                            >
                              {{ $t('chat.heal') }}
                            </button>
                            <template v-else>
                              <button
                                type="button"
                                data-action="damage"
                                class="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 active:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="
                                  !canTriggerDamageAction(view.message, roll, rollIndex, 'damage')
                                "
                                :aria-busy="isDamageActionPending(view.message, rollIndex)"
                                @click="applyDamageRoll(view.message, roll, rollIndex, 'damage')"
                              >
                                {{ $t('chat.damage') }}
                              </button>
                              <button
                                type="button"
                                data-action="half"
                                class="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="
                                  !canTriggerDamageAction(view.message, roll, rollIndex, 'half')
                                "
                                :aria-busy="isDamageActionPending(view.message, rollIndex)"
                                @click="applyDamageRoll(view.message, roll, rollIndex, 'half')"
                              >
                                {{ $t('chat.half') }}
                              </button>
                              <button
                                type="button"
                                data-action="double"
                                class="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="
                                  !canTriggerDamageAction(view.message, roll, rollIndex, 'double')
                                "
                                :aria-busy="isDamageActionPending(view.message, rollIndex)"
                                @click="applyDamageRoll(view.message, roll, rollIndex, 'double')"
                              >
                                {{ $t('chat.double') }}
                              </button>
                              <button
                                type="button"
                                data-action="block"
                                class="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-100 active:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="
                                  !canTriggerDamageAction(view.message, roll, rollIndex, 'block')
                                "
                                :aria-busy="isDamageActionPending(view.message, rollIndex)"
                                @click="applyDamageRoll(view.message, roll, rollIndex, 'block')"
                              >
                                {{ $t('chat.block') }}
                              </button>
                            </template>
                          </div>
                        </div>
                      </div>
                      <div v-if="view.showEmptyMessage" class="mt-2 text-sm text-gray-500 italic">
                        {{ $t('chat.emptyMessage') }}
                      </div>
                    </li>
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
                class="border-divider flex flex-none items-end gap-2 border-t p-3"
                :data-private="selectedWhisperCommandTargets.length ? true : undefined"
                @submit.prevent="submitChatMessage"
              >
                <div class="relative min-w-0 flex-1">
                  <div
                    data-part="chat-recipient"
                    class="mb-1 flex items-center gap-1.5 text-xs text-gray-500"
                  >
                    <span>{{ $t('chat.to') }}</span>
                    <Menu as="div" class="relative min-w-0">
                      <MenuButton
                        type="button"
                        data-part="chat-recipient-button"
                        class="inline-flex max-w-56 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
                        :class="
                          selectedWhisperCommandTargets.length
                            ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                            : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                        "
                        :aria-label="$t('chat.recipient')"
                      >
                        <span class="truncate">{{ selectedWhisperLabel }}</span>
                        <ChevronDownIcon class="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                      </MenuButton>
                      <MenuItems
                        data-part="chat-recipient-menu"
                        class="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-black/5 focus:outline-hidden"
                      >
                        <MenuItem
                          v-for="target in whisperGroupTargets"
                          :key="target.key"
                          v-slot="{ active }"
                        >
                          <button
                            type="button"
                            data-part="chat-recipient-menu-item"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                            :class="active ? 'bg-gray-100 text-gray-900' : ''"
                            @click="
                              selectWhisperGroup(
                                target.key === GMS_WHISPER_TARGET
                                  ? GMS_WHISPER_TARGET
                                  : PUBLIC_WHISPER_TARGET
                              )
                            "
                          >
                            <span class="min-w-0 flex-1 truncate">{{ target.label }}</span>
                            <CheckIcon
                              v-if="selectedWhisperMode === target.key"
                              class="h-4 w-4 flex-none text-blue-600"
                              aria-hidden="true"
                            />
                          </button>
                        </MenuItem>
                        <div
                          v-if="whisperUserTargets.length"
                          class="my-1 border-t border-gray-200"
                          aria-hidden="true"
                        />
                        <MenuItem
                          v-for="target in whisperUserTargets"
                          :key="target.key"
                          as="div"
                          v-slot="{ active }"
                        >
                          <button
                            type="button"
                            data-part="chat-recipient-menu-item"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
                            :class="active ? 'bg-gray-100 text-gray-900' : ''"
                            :aria-pressed="userTargetSelected(target.key)"
                            @click.prevent.stop="toggleWhisperUser(target.key)"
                          >
                            <span class="min-w-0 flex-1 truncate">{{ target.label }}</span>
                            <CheckIcon
                              v-if="userTargetSelected(target.key)"
                              class="h-4 w-4 flex-none text-blue-600"
                              aria-hidden="true"
                            />
                          </button>
                        </MenuItem>
                      </MenuItems>
                    </Menu>
                  </div>
                  <textarea
                    ref="chatInput"
                    v-model="draft"
                    class="block max-h-32 min-h-12 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                    rows="2"
                    :placeholder="$t('chat.placeholder')"
                    :disabled="isSending || !_id"
                    @keydown.enter.exact.prevent="submitChatMessage"
                    @keydown.meta.enter.prevent="submitChatMessage"
                    @keydown.ctrl.enter.prevent="submitChatMessage"
                  />
                  <p v-if="sendError" data-part="chat-error" class="mt-1 text-xs text-red-700">
                    {{ $t('chat.sendFailed') }}
                  </p>
                </div>
                <button
                  type="submit"
                  class="inline-flex h-12 w-12 flex-none items-center justify-center rounded-md bg-blue-600 text-white transition-colors enabled:hover:bg-blue-500 enabled:active:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!canSend"
                  :aria-label="$t('chat.send')"
                >
                  <span
                    v-if="isSending"
                    class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  <PaperAirplaneIcon v-else class="h-5 w-5" aria-hidden="true" />
                </button>
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
