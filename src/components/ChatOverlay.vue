<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'
import { PaperAirplaneIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useWorldStore } from '@/stores/world'
import { sendChatMessage, consumeItem, applyDamage } from '@/api/actionRpc'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useOverlayStack } from '@/composables/useOverlayStack'
import ChatInlineRollModal from '@/components/ChatInlineRollModal.vue'
import CompendiumItemModal from '@/components/CompendiumItemModal.vue'
import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'
import { getPath } from '@/utils/utilities'
import {
  activeRollFromFoundryClickTarget,
  compendiumItemUuidFromClickTarget,
  prepareChatHtml
} from '@/utils/foundryHtml'
import type { ActiveRoll, ApplyDamageMode } from '@/types/api-types'

type CollectionLike<T> =
  | T[]
  | {
      contents?: T[]
      values?: () => IterableIterator<T>
    }
  | undefined

interface ChatSpeaker {
  alias?: string
  actor?: string
  scene?: string
  token?: string
}

interface ChatMessageData {
  _id?: string | null
  author?: string | { _id?: string | null; name?: string | null } | null
  user?: string | null
  timestamp?: number | null
  flavor?: string | null
  content?: string | null
  speaker?: ChatSpeaker | null
  whisper?: string[]
  blind?: boolean
  rolls?: Array<string | RollJson>
  type?: string
  flags?: {
    pf2e?: {
      origin?: { uuid?: string | null }
    }
  }
}

interface RollTermJson {
  class?: string
  options?: { flavor?: string | null; [key: string]: unknown }
  formula?: string
  terms?: RollTermJson[]
  rolls?: RollJson[]
  results?: Array<{ result?: number; active?: boolean }>
  number?: number
  faces?: number
  total?: number
  [key: string]: unknown
}

interface RollJson extends RollTermJson {
  dice?: RollTermJson[]
  evaluated?: boolean
}

interface ChatRollDie {
  formula: string
  flavor?: string
  faces?: number
  results: number[]
}

interface ChatRollSummary {
  className?: string
  formula?: string
  total?: number
  flavors: string[]
  dice: ChatRollDie[]
  isHealing: boolean
}

interface UserData {
  _id?: string | null
  id?: string | null
  name?: string | null
}

interface ChatTokenData {
  _id?: string | null
  actorId?: string | null
  texture?: {
    src?: string | null
    scaleX?: number | null
    scaleY?: number | null
  }
}

interface ChatSceneData {
  _id?: string | null
  active?: boolean
  tokens?: CollectionLike<ChatTokenData>
}

interface ChatMessageView {
  message: ChatMessageData
  key: string
  speakerName: string
  authorName: string
  showAuthorName: boolean
  formattedTime: string
  visibilityLabel: string | null
  isOwnActor: boolean
  portrait?: string
  portraitScale: { '--sx': number; '--sy': number }
  preparedFlavor?: string
  preparedContent?: string
  showContent: boolean
  showEmptyMessage: boolean
  rolls: ChatRollSummary[]
}

const isOpen = ref(false)
const scrollContainer = ref<HTMLElement>()
const { zIndex, openLayer, closeLayer } = useOverlayStack()
const { world } = storeToRefs(useWorldStore())
const character = useInjectedCharacter()
const { _id, _actor, shield } = character
const draft = ref('')
const isSending = ref(false)
const sendError = ref(false)
const actionError = ref(false)
const pendingDamageActions = ref(new Set<string>())
const pendingConsumeMessages = ref(new Set<string>())
const inlineRollModal = ref<InstanceType<typeof ChatInlineRollModal>>()
const compendiumModal = ref<InstanceType<typeof CompendiumItemModal>>()
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

function collectionToArray<T>(source: CollectionLike<T>): T[] {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  return []
}

const users = computed(() =>
  collectionToArray<UserData>(world.value?.users as CollectionLike<UserData>)
)
const userNamesById = computed(() => {
  const names = new Map<string, string>()
  users.value.forEach((user) => {
    if (!user.name) return
    if (user._id) names.set(user._id, user.name)
    if (user.id) names.set(user.id, user.name)
  })
  return names
})
const scenes = computed(() =>
  collectionToArray<ChatSceneData>(world.value?.scenes as CollectionLike<ChatSceneData>)
)

const messages = computed(() =>
  collectionToArray<ChatMessageData>(world.value?.messages as CollectionLike<ChatMessageData>)
    .slice()
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
)
const canSend = computed(() => !!_id.value && draft.value.trim().length > 0 && !isSending.value)

function originActorId(message: ChatMessageData): string | undefined {
  const uuid = message.flags?.pf2e?.origin?.uuid
  if (uuid) return /^Actor\.([^.]+)/.exec(uuid)?.[1]
  return message.speaker?.actor ?? undefined
}

function originItemId(message: ChatMessageData): string | undefined {
  const uuid = message.flags?.pf2e?.origin?.uuid
  if (!uuid) return undefined
  return /\.Item\.([^.]+)$/.exec(uuid)?.[1]
}

function messageIsOwnActor(message: ChatMessageData): boolean {
  return !!_id.value && originActorId(message) === _id.value
}

function speakerName(message: ChatMessageData, resolvedAuthor = authorName(message)): string {
  return message.speaker?.alias || resolvedAuthor || 'Unknown'
}

function authorName(message: ChatMessageData): string {
  if (typeof message.author === 'object' && message.author?.name) return message.author.name
  const authorId = typeof message.author === 'string' ? message.author : (message.user ?? '')
  return userNamesById.value.get(authorId) ?? authorId
}

function formattedTime(timestamp?: number | null): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(new Date(timestamp))
}

function visibilityLabel(message: ChatMessageData): string | null {
  if (message.blind) return 'chat.blind'
  if (message.whisper?.length) return 'chat.whisper'
  return null
}

function messageKey(message: ChatMessageData, index: number): string {
  return message._id ?? `${message.timestamp ?? 'message'}-${index}`
}

function speakerToken(message: ChatMessageData): ChatTokenData | undefined {
  const speaker = message.speaker
  if (!speaker?.token) return undefined
  const scene =
    scenes.value.find((s) => s._id === speaker.scene) ?? scenes.value.find((s) => s.active)
  return collectionToArray(scene?.tokens).find((token) => token._id === speaker.token)
}

function tokenPortrait(token: ChatTokenData | undefined): string | undefined {
  const src = token?.texture?.src
  return src ? getPath(src) : undefined
}

function tokenScale(token: ChatTokenData | undefined): { '--sx': number; '--sy': number } {
  const texture = token?.texture
  return {
    '--sx': texture?.scaleX ?? 1,
    '--sy': texture?.scaleY ?? 1
  }
}

function parseRollJson(roll: string | RollJson | undefined): RollJson | undefined {
  if (!roll) return undefined
  if (typeof roll !== 'string') return roll
  try {
    const parsed = JSON.parse(roll)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function formulaFlavors(formula: string | undefined): string[] {
  if (!formula) return []
  return Array.from(formula.matchAll(/\[([^\]]+)\]/g))
    .flatMap((match) => match[1].split(','))
    .map((flavor) => flavor.trim())
    .filter(Boolean)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function termDamageType(term: RollTermJson): string | undefined {
  const options = term.options ?? {}
  return (
    stringValue(term.damageType) ??
    stringValue(term.type) ??
    stringValue(options.damageType) ??
    stringValue(options.type) ??
    stringValue(options.flavor) ??
    formulaFlavors(term.formula)[0]
  )
}

function collectRollTerms(
  term: RollTermJson | undefined,
  out: RollTermJson[] = []
): RollTermJson[] {
  if (!term) return out
  out.push(term)
  term.terms?.forEach((child) => collectRollTerms(child, out))
  term.rolls?.forEach((child) => collectRollTerms(child, out))
  return out
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

function dieResults(term: RollTermJson): number[] {
  return (
    term.results
      ?.filter((result) => result.active !== false && typeof result.result === 'number')
      .map((result) => result.result as number) ?? []
  )
}

function dieFormula(term: RollTermJson): string | undefined {
  if (term.formula) return term.formula
  if (term.number && term.faces) return `${term.number}d${term.faces}`
  return undefined
}

function rollSummary(roll: string | RollJson | undefined): ChatRollSummary | undefined {
  const parsed = parseRollJson(roll)
  if (!parsed) return undefined

  const terms = collectRollTerms(parsed)
  const dice = terms
    .filter((term) => term.class === 'Die' || (term.faces && term.number))
    .map((term) => ({
      formula: dieFormula(term) ?? 'die',
      flavor: term.options?.flavor ?? formulaFlavors(term.formula)[0],
      faces: term.faces,
      results: dieResults(term)
    }))

  const flavors = uniqueStrings([
    ...terms.map((term) => term.options?.flavor),
    ...terms.flatMap((term) => formulaFlavors(term.formula))
  ])
  const damageTypes = uniqueStrings(terms.map(termDamageType))

  if (!dice.length && !flavors.length && !parsed.formula && typeof parsed.total !== 'number') {
    return undefined
  }

  return {
    className: parsed.class,
    formula: parsed.formula,
    total: typeof parsed.total === 'number' ? parsed.total : undefined,
    flavors,
    dice,
    isHealing: damageTypes.some((type) => type.toLowerCase() === 'healing')
  }
}

function rollSummaries(message: ChatMessageData): ChatRollSummary[] {
  return message.rolls?.map(rollSummary).filter((roll): roll is ChatRollSummary => !!roll) ?? []
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

function canApplyDamage(roll: ChatRollSummary): boolean {
  return roll.className === 'DamageRoll' && roll.total !== undefined && !!_actor.value
}

function setHas(setRef: Ref<Set<string>>, key: string): boolean {
  return setRef.value.has(key)
}

function setPending(setRef: Ref<Set<string>>, key: string, pending: boolean) {
  const next = new Set(setRef.value)
  if (pending) next.add(key)
  else next.delete(key)
  setRef.value = next
}

function damageActionKey(message: ChatMessageData, rollIndex: number): string | undefined {
  if (!message._id) return undefined
  return `${message._id}:${rollIndex}`
}

function consumeActionKey(message: ChatMessageData): string | undefined {
  return message._id ?? undefined
}

function canShieldBlock(): boolean {
  return (
    !!shield.itemId.value && (shield.hp.current.value ?? 0) > 0 && (shield.hardness.value ?? 0) > 0
  )
}

function isDamageActionPending(
  message: ChatMessageData,
  rollIndex: number
): boolean {
  const key = damageActionKey(message, rollIndex)
  return !!key && setHas(pendingDamageActions, key)
}

function canTriggerDamageAction(
  message: ChatMessageData,
  roll: ChatRollSummary,
  rollIndex: number,
  mode: ApplyDamageMode
): boolean {
  if (!canApplyDamage(roll)) return false
  if (mode === 'block' && !canShieldBlock()) return false
  const key = damageActionKey(message, rollIndex)
  return !!key && !setHas(pendingDamageActions, key)
}

async function applyDamageRoll(
  message: ChatMessageData,
  roll: ChatRollSummary,
  rollIndex: number,
  mode: ApplyDamageMode
) {
  if (!canTriggerDamageAction(message, roll, rollIndex, mode)) return
  const key = damageActionKey(message, rollIndex)
  if (!key || !message._id) return

  actionError.value = false
  setPending(pendingDamageActions, key, true)
  try {
    await applyDamage(_actor as Ref<CharacterPF2e>, message._id, mode, rollIndex)
  } catch {
    actionError.value = true
  } finally {
    setPending(pendingDamageActions, key, false)
  }
}

function plainChatText(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function shouldShowMessageContent(
  message: ChatMessageData,
  summaries = rollSummaries(message)
): boolean {
  if (!message.content) return false
  if (!summaries.length) return true
  const contentText = plainChatText(message.content)
  return !summaries.some((roll) => roll.total !== undefined && contentText === String(roll.total))
}

function buildChatMessageView(message: ChatMessageData, index: number): ChatMessageView {
  const rolls = rollSummaries(message)
  const showContent = shouldShowMessageContent(message, rolls)
  const token = speakerToken(message)
  const author = authorName(message)
  const speaker = speakerName(message, author)
  const visibility = visibilityLabel(message)

  return {
    message,
    key: messageKey(message, index),
    speakerName: speaker,
    authorName: author,
    showAuthorName: !!author && author !== speaker,
    formattedTime: formattedTime(message.timestamp),
    visibilityLabel: visibility,
    isOwnActor: messageIsOwnActor(message),
    portrait: tokenPortrait(token),
    portraitScale: tokenScale(token),
    preparedFlavor: message.flavor ? prepareChatHtml(message.flavor) : undefined,
    preparedContent: showContent ? prepareChatHtml(message.content) : undefined,
    showContent,
    showEmptyMessage: !showContent && !rolls.length,
    rolls
  }
}

const renderedMessages = computed(() => messages.value.map(buildChatMessageView))

function openInlineRoll(roll: ActiveRoll | undefined) {
  if (!roll) return
  inlineRollModal.value?.open(roll)
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

async function handleCardButtonClick(event: MouseEvent) {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '.card-buttons button[data-action="consume"]'
  )
  if (!btn) return
  event.preventDefault()
  event.stopPropagation()
  const msgEl = btn.closest<HTMLElement>('[data-message-id]')
  const message = messages.value.find((m) => m._id === msgEl?.dataset.messageId)
  if (!message || !messageIsOwnActor(message) || !_actor.value) return
  const itemId = originItemId(message)
  if (!itemId) return
  const key = consumeActionKey(message)
  if (!key || setHas(pendingConsumeMessages, key)) return

  actionError.value = false
  setPending(pendingConsumeMessages, key, true)
  btn.disabled = true
  btn.setAttribute('aria-busy', 'true')
  try {
    await consumeItem(_actor as Ref<CharacterPF2e>, itemId)
  } catch {
    actionError.value = true
  } finally {
    setPending(pendingConsumeMessages, key, false)
    btn.disabled = false
    btn.removeAttribute('aria-busy')
  }
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

async function submitMessage() {
  const content = draft.value.trim()
  if (!content || !_id.value || isSending.value) return

  isSending.value = true
  sendError.value = false
  try {
    await sendChatMessage(_id.value, content)
    draft.value = ''
    scrollToBottom(true)
  } catch {
    sendError.value = true
  } finally {
    isSending.value = false
  }
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
                            <div
                              v-if="view.showAuthorName"
                              class="truncate text-xs text-gray-500"
                            >
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
                          <time
                            v-if="view.formattedTime"
                            class="ml-auto text-xs text-gray-500"
                          >
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
                    <div v-if="view.rolls.length" data-part="chat-rolls" class="mt-2 space-y-2">
                      <div
                        v-for="(roll, rollIndex) in view.rolls"
                        :key="`${view.key}-roll-${rollIndex}`"
                        data-part="chat-roll"
                        class="rounded border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        <div
                          v-if="roll.formula || roll.dice.length"
                          data-part="chat-roll-details"
                          class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-gray-500"
                        >
                          <span
                            v-if="roll.formula"
                            data-part="chat-roll-formula"
                            class="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 break-words text-gray-600"
                          >
                            {{ rollFormulaLabel(roll) }}
                          </span>
                          <span
                            v-if="roll.dice.length"
                            data-part="chat-roll-dice"
                            class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
                          >
                            <template v-for="(die, dieIndex) in roll.dice" :key="dieIndex">
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
                          <span v-if="roll.total !== undefined" class="text-base font-semibold">
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
                    <div
                      v-if="view.showEmptyMessage"
                      class="mt-2 text-sm text-gray-500 italic"
                    >
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
    </Dialog>
  </TransitionRoot>
</template>
