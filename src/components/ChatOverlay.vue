<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'
import { PaperAirplaneIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useWorldStore } from '@/stores/world'
import { sendChatMessage, consumeItem } from '@/api/actionRpc'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useOverlayStack } from '@/composables/useOverlayStack'
import ChatInlineRollModal from '@/components/ChatInlineRollModal.vue'
import CompendiumItemModal from '@/components/CompendiumItemModal.vue'
import { getPath } from '@/utils/utilities'
import {
  activeRollFromFoundryClickTarget,
  compendiumItemUuidFromClickTarget,
  prepareChatHtml
} from '@/utils/foundryHtml'
import type { ActiveRoll } from '@/types/api-types'

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
  rolls?: string[]
  type?: string
  flags?: {
    pf2e?: {
      origin?: { uuid?: string | null }
    }
  }
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

const isOpen = ref(false)
const scrollContainer = ref<HTMLElement>()
const { zIndex, openLayer, closeLayer } = useOverlayStack()
const { world } = storeToRefs(useWorldStore())
const { _id, _actor } = useInjectedCharacter()
const draft = ref('')
const isSending = ref(false)
const sendError = ref(false)
const inlineRollModal = ref<InstanceType<typeof ChatInlineRollModal>>()
const compendiumModal = ref<InstanceType<typeof CompendiumItemModal>>()
let scrollAnimationFrame: number | undefined

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

function speakerName(message: ChatMessageData): string {
  return message.speaker?.alias || authorName(message) || 'Unknown'
}

function authorName(message: ChatMessageData): string {
  if (typeof message.author === 'object' && message.author?.name) return message.author.name
  const authorId = typeof message.author === 'string' ? message.author : (message.user ?? '')
  return users.value.find((u) => u._id === authorId || u.id === authorId)?.name ?? authorId
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

function speakerTokenPortrait(message: ChatMessageData): string | undefined {
  const src = speakerToken(message)?.texture?.src
  return src ? getPath(src) : undefined
}

function speakerTokenScale(message: ChatMessageData): { '--sx': number; '--sy': number } {
  const texture = speakerToken(message)?.texture
  return {
    '--sx': texture?.scaleX ?? 1,
    '--sy': texture?.scaleY ?? 1
  }
}

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

function handleCardButtonClick(event: MouseEvent) {
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
  consumeItem(_actor as Ref<CharacterPF2e>, itemId)
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
              class="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl transition-all sm:h-[min(760px,calc(100dvh-2rem))] sm:rounded-lg"
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

              <div ref="scrollContainer" class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
                <div
                  v-if="messages.length === 0"
                  class="px-3 py-8 text-center text-gray-500 italic"
                >
                  {{ $t('chat.noMessages') }}
                </div>
                <ol v-else class="flex flex-col gap-3">
                  <li
                    v-for="(message, index) in messages"
                    :key="messageKey(message, index)"
                    data-part="chat-message"
                    class="rounded-md border border-gray-200 bg-gray-50 p-3"
                    :data-message-id="message._id ?? undefined"
                    :data-message-type="message.type"
                    :data-private="!!visibilityLabel(message)"
                    :data-own-message="messageIsOwnActor(message)"
                  >
                    <div class="flex gap-3">
                      <div
                        v-if="speakerTokenPortrait(message)"
                        data-part="chat-portrait"
                        class="h-12 w-12 flex-none rounded"
                      >
                        <img
                          class="h-full w-full scale-x-(--sx) scale-y-(--sy) object-cover"
                          :src="speakerTokenPortrait(message)"
                          :alt="speakerName(message)"
                          :style="speakerTokenScale(message)"
                        />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex gap-2">
                          <div class="min-w-0 flex-1">
                            <div class="truncate font-semibold text-gray-900">
                              {{ speakerName(message) }}
                            </div>
                            <div
                              v-if="
                                authorName(message) && authorName(message) !== speakerName(message)
                              "
                              class="truncate text-xs text-gray-500"
                            >
                              {{ authorName(message) }}
                            </div>
                          </div>
                          <span
                            v-if="visibilityLabel(message)"
                            data-part="visibility"
                            class="mt-0.5 self-start text-xs"
                          >
                            {{ $t(visibilityLabel(message)!) }}
                          </span>
                          <time v-if="message.timestamp" class="ml-auto text-xs text-gray-500">
                            {{ formattedTime(message.timestamp) }}
                          </time>
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="message.flavor"
                      data-part="chat-flavor"
                      class="mt-2 mb-2 text-sm font-medium text-gray-700"
                      v-html="prepareChatHtml(message.flavor)"
                      @click="handleChatContentClick($event)"
                    />
                    <div
                      v-if="message.content"
                      data-part="chat-content"
                      class="mt-2 text-sm text-gray-900"
                      v-html="prepareChatHtml(message.content)"
                      @click="(handleChatContentClick($event), handleCardButtonClick($event))"
                    />
                    <div v-else class="mt-2 text-sm text-gray-500 italic">
                      {{ $t('chat.emptyMessage') }}
                    </div>
                  </li>
                </ol>
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
