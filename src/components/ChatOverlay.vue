<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { EllipsisVerticalIcon, PaperAirplaneIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useOverlayStack } from '@/composables/useOverlayStack'
import { useChatActions } from '@/composables/useChatActions'
import {
  messageIsReroll,
  useChatMessages,
  type ChatMessageData
} from '@/composables/useChatMessages'
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
  onMessageSent: () => scrollToBottom(true)
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
  isOpen.value = true
  scrollToBottom()
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
    if (openNow) scrollToBottom()
  }
)

watch(
  () => messages.value.length,
  (messageCount, previousMessageCount) => {
    if (isOpen.value && messageCount > previousMessageCount) scrollToBottom(true)
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
                class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
              >
                <div
                  v-if="messages.length === 0"
                  class="px-3 py-8 text-center text-gray-500 italic"
                >
                  {{ $t('chat.noMessages') }}
                </div>
                <ol v-else class="flex flex-col gap-3">
                  <li
                    v-for="view in renderedMessages"
                    :key="view.key"
                    data-part="chat-message"
                    class="rounded-md border border-gray-200 bg-gray-50 p-3"
                    :data-message-id="view.message._id ?? undefined"
                    :data-message-type="view.message.type"
                    :data-private="!!view.visibilityLabel"
                    :data-own-message="view.isOwnActor"
                  >
                    <div class="flex gap-3">
                      <div
                        v-if="view.portrait"
                        data-part="chat-portrait"
                        class="h-12 w-12 flex-none rounded"
                      >
                        <img
                          class="h-full w-full scale-x-(--sx) scale-y-(--sy) object-cover"
                          :src="view.portrait"
                          :alt="view.speakerName"
                          :style="view.portraitScale"
                        />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex gap-2">
                          <div class="min-w-0 flex-1">
                            <div class="truncate font-semibold text-gray-900">
                              {{ view.speakerName }}
                            </div>
                            <div v-if="view.showAuthorName" class="truncate text-xs text-gray-500">
                              {{ view.authorName }}
                            </div>
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
                        <img :src="d20Icon" class="h-3.5 w-3.5 flex-none" alt="" aria-hidden="true" />
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
                                  !canTriggerRollAction(view.message, roll, rollIndex, 'hero-point')
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
                                    view.rerollSummary.oldDiscarded ? 'line-through opacity-60' : ''
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
                                    view.rerollSummary.newDiscarded ? 'line-through opacity-60' : ''
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
                          <span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
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
                            class="text-xs text-gray-500"
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
                @submit.prevent="submitMessage"
              >
                <div class="min-w-0 flex-1">
                  <textarea
                    v-model="draft"
                    class="block max-h-32 min-h-12 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                    rows="2"
                    :placeholder="$t('chat.placeholder')"
                    :disabled="isSending || !_id"
                    @keydown.enter.exact.prevent="submitMessage"
                    @keydown.meta.enter.prevent="submitMessage"
                    @keydown.ctrl.enter.prevent="submitMessage"
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
