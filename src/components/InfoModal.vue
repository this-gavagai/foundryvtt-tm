<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { sendItemToChat } from '@/api/actions'
import { usePixelDiceStore } from '@/stores/pixelDice'
import { getPath } from '@/utils/utilities'
import { makeTraits } from '@/utils/utilities'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useSettingsStore } from '@/stores/settings'
import Modal from './ModalBox.vue'
import Spinner from './widgets/SpinnerWidget.vue'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'

import Button from './widgets/ButtonWidget.vue'

import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'

const dieIcons: Record<string, string> = {
  d4: d4Icon,
  d6: d6Icon,
  d8: d8Icon,
  d10: d10Icon,
  d12: d12Icon,
  d20: d20Icon
}

const { _id: characterId } = useInjectedCharacter()

const { pixel, lastRoll } = storeToRefs(usePixelDiceStore())
const { isListening } = storeToRefs(useListenersStore())
const { manualDicePicker } = storeToRefs(useSettingsStore())

const rollResultModal = ref()
const waiting = ref(false)

const props = defineProps<{
  imageUrl?: string
  traits?: string[]
  itemId?: string
  rolls?: Roll[]
}>()

// The roll that consumes the next physical-die input: prefer an explicitly
// armed roll; otherwise the first dice-eligible roll.
const armedRoll = computed<Roll | undefined>(() => {
  const list = props.rolls ?? []
  return list.find((r) => r.armed && r.dice?.length) ?? list.find((r) => r.dice?.length)
})

// Per-die face selections for the armed roll. The buffer is always sized to
// the armed roll's dice list so manual face-picking can address any slot
// directly. For Pixel input we fill the next empty slot in order. A single-
// die roll (d20 check) fills and fires in one step; multi-die rolls (e.g.
// 2d8+1d6) accumulate across rolls or picks until every slot is filled.
const buffer = ref<(number | undefined)[]>([])

function emptyBuffer(): (number | undefined)[] {
  return (armedRoll.value?.dice ?? []).map(() => undefined)
}

const bufferComplete = computed(
  () => buffer.value.length > 0 && buffer.value.every((v) => v !== undefined)
)

// Reset the buffer whenever arming switches to a different roll — partially
// collected faces for the old roll shouldn't carry over.
watch(
  () => armedRoll.value?.key,
  () => {
    buffer.value = emptyBuffer()
  }
)

// Also re-shape the buffer if the armed roll's dice list changes (e.g. the
// damage formula resolves asynchronously and goes from `[]` to `['d8']`).
watch(
  () => armedRoll.value?.dice?.length ?? 0,
  (n) => {
    if (buffer.value.length !== n) buffer.value = emptyBuffer()
  }
)

function executeRoll(roll: Roll, faces?: number[]) {
  if (roll.disabled) return
  buffer.value = emptyBuffer()
  return Promise.resolve(roll.execute(faces)).then(
    (r: RequestResolutionArgs | null | undefined) => {
      close(true)
      rollResultModal.value.open(r)
    }
  )
}

// Roll buttons clicked manually: use the buffer only if the armed roll is the
// one being fired and every face is selected.
function executeRollFromButton(roll: Roll) {
  const isArmed = roll.key === armedRoll.value?.key
  if (isArmed && bufferComplete.value) {
    executeRoll(roll, buffer.value as number[])
  } else {
    executeRoll(roll)
  }
}

watch(lastRoll, () => {
  const roll = armedRoll.value
  if (!isOpen.value || !roll?.dice?.length || lastRoll.value == null) return
  // Fill the first empty slot in order; if every slot is already filled the
  // physical roll is ignored (use the Roll button or clear first).
  const idx = buffer.value.findIndex((v) => v === undefined)
  if (idx === -1) return
  const next = [...buffer.value]
  next[idx] = lastRoll.value
  if (next.every((v) => v !== undefined)) executeRoll(roll, next as number[])
  else buffer.value = next
})

function pickFace(slot: number, value: number) {
  const next = [...buffer.value]
  next[slot] = next[slot] === value ? undefined : value
  buffer.value = next
}

function clearBuffer() {
  buffer.value = emptyBuffer()
}

function dieFaces(die: string): number[] {
  const n = Number(die.slice(1))
  return Array.from({ length: n }, (_, i) => i + 1)
}

const isOpen = ref(false)
function open() {
  isOpen.value = true
  waiting.value = false
  buffer.value = []
  emit('opening')
}
function close(ignoreModal = false) {
  if (rollResultModal.value.isOpen && !ignoreModal) {
    rollResultModal.value.close()
    return
  }
  isOpen.value = false
  emit('closing')
}

const dragOptions = {
  swipeDistance: 50
}
const handleDrag = ({ swipe }: { swipe: [number, number] }) => {
  if (swipe[1]) close()
}

function sendCurrentItemToChat() {
  if (!props.itemId || !characterId.value || !isListening.value) return
  waiting.value = true
  sendItemToChat(characterId.value, props.itemId).then(() => (waiting.value = false))
}

const emit = defineEmits(['opening', 'closing', 'imgClick'])
defineExpose({ open, close, rollResultModal })
</script>
<template>
  <div class="touch-manipulation transition-all">
    <TransitionRoot appear :show="isOpen" as="template">
      <Dialog as="div" @close="close" class="relative z-10">
        <TransitionChild
          as="template"
          enter="duration-300 ease-out"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="duration-100 ease-in"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-[#000D]" />
        </TransitionChild>

        <div class="fixed inset-x-0 bottom-0 overflow-y-auto">
          <div class="bottom items-bottom flex justify-center overflow-hidden p-0 pb-0 text-center">
            <TransitionChild
              as="template"
              enter="duration-300 ease-out"
              enter-from="translate-y-full"
              enter-to="translate-y-0"
              leave="duration-200 ease-in"
              leave-from="translate-y-0"
              leave-to="translate-y-full"
            >
              <DialogPanel
                data-part="panel"
                class="relative w-full max-w-4xl transform overflow-hidden bg-white p-6 text-left shadow-xl transition-all"
              >
                <div
                  class="max-h-[70vh] overflow-auto"
                  v-drag="handleDrag"
                  :dragOptions="dragOptions"
                >
                  <div class="flex space-x-2">
                    <div
                      v-if="props.itemId && characterId && isListening"
                      class="border"
                      :class="[isListening ? 'active:opacity-30' : '']"
                      @click="sendCurrentItemToChat"
                    >
                      <img
                        class="h-12 w-12"
                        :class="[waiting ? 'opacity-50' : '']"
                        v-if="props.imageUrl"
                        :src="getPath(props.imageUrl)"
                        :alt="$t('infoModal.systemIcon')"
                      />
                      <Spinner
                        class="absolute -mt-9 ml-3 h-6 w-6 transition-opacity"
                        :class="[waiting ? 'opacity-100' : 'opacity-0']"
                      />
                    </div>
                    <div>
                      <DialogTitle as="h3" class="text-lg leading-6 font-medium text-gray-900">
                        <slot name="title"></slot>
                      </DialogTitle>
                      <div class="absolute top-0 right-0 pt-4 pr-4 sm:block">
                        <button
                          type="button"
                          data-part="close"
                          class="cursor-pointer rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-hidden"
                          @click="close(true)"
                        >
                          <span class="sr-only">{{ $t('common.close') }}</span>
                          <XMarkIcon class="h-6 w-6" aria-hidden="true" />
                        </button>
                      </div>
                      <DialogDescription>
                        <slot name="description"></slot>
                      </DialogDescription>
                    </div>
                  </div>
                  <div
                    v-if="props.traits"
                    class="mt-2 text-sm [&_p]:my-2"
                    v-html="makeTraits(props.traits)"
                  ></div>
                  <div>
                    <slot name="beforeBody"></slot>
                  </div>
                  <div class="mt-2 text-sm [&_p]:my-2">
                    <div
                      class="[&_table]:mb-2.5 [&_table]:border [&_table]:border-[gray] [&_table_:is(td,th)]:min-w-20 [&_table_:is(td,th)]:border [&_table_:is(td,th)]:border-[gray] [&_table_:is(td,th)]:p-1.25"
                    >
                      <slot name="body"></slot>
                    </div>
                  </div>
                  <div>
                    <slot></slot>
                  </div>
                </div>
                <div
                  v-if="manualDicePicker && armedRoll?.dice?.length"
                  data-part="face-picker"
                  class="mt-4 flex flex-col gap-1"
                >
                  <div
                    v-for="(die, slot) in armedRoll.dice"
                    :key="slot + '_' + die"
                    class="flex items-start gap-2"
                  >
                    <div class="flex w-10 shrink-0 items-center gap-1 pt-0.5">
                      <img :src="dieIcons[die] ?? d20Icon" class="h-5" />
                      <span class="text-xs uppercase opacity-60">{{ die }}</span>
                    </div>
                    <div class="flex flex-wrap gap-1">
                      <button
                        v-for="face in dieFaces(die)"
                        :key="face"
                        type="button"
                        :data-selected="buffer[slot] === face ? true : undefined"
                        class="h-6 w-6 cursor-pointer rounded border text-xs leading-none"
                        :class="buffer[slot] === face ? 'bg-gray-300 hover:bg-gray-400' : ''"
                        @click="pickFace(slot, face)"
                      >
                        {{ face }}
                      </button>
                    </div>
                  </div>
                </div>
                <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <!-- Left-aligned slot, paired with `justify-end` on the row
                       via `mr-auto`. Used by modals that need a per-action
                       control inline with the roll button (e.g. secret toggle). -->
                  <div class="mr-auto empty:hidden">
                    <slot name="bottomLeft"></slot>
                  </div>
                  <div
                    v-if="pixel && pixel.status === 'ready' && armedRoll?.dice?.length"
                    class="flex grow cursor-pointer items-center gap-1"
                    :title="$t('infoModal.clearDicePending')"
                    @click="clearBuffer"
                  >
                    <div
                      v-for="(die, slot) in armedRoll.dice"
                      class="relative flex h-8 items-center"
                      :key="slot + '_' + die"
                    >
                      <img
                        :src="dieIcons[die] ?? d20Icon"
                        class="h-8 transition-opacity"
                        :class="
                          buffer[slot] !== undefined ? 'opacity-20' : 'animate-bounce opacity-50'
                        "
                      />
                      <span
                        v-if="buffer[slot] !== undefined"
                        class="absolute inset-0 flex items-center justify-center text-xs font-bold"
                      >
                        {{ buffer[slot] }}
                      </span>
                    </div>
                  </div>
                  <Button
                    v-for="roll in props.rolls ?? []"
                    :key="roll.key"
                    :color="roll.color ?? 'blue'"
                    :disabled="roll.disabled"
                    :data-armed="roll.key === armedRoll?.key ? true : undefined"
                    :clicked="() => executeRollFromButton(roll)"
                    >{{ roll.label }}</Button
                  >
                  <slot name="actionButtons"></slot>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
    <Teleport to="#modals">
      <Modal ref="rollResultModal">
        <div class="flex">
          <div class="m-auto">
            <div class="m-auto">{{ rollResultModal?.options?.roll?.formula }}</div>
            <div
              class="flex items-center justify-center"
              v-for="(die, i) in rollResultModal?.options?.roll?.dice"
              :key="'die_' + i"
            >
              <div class="flex gap-1 text-2xl">
                <div
                  v-for="(result, j) in die.results"
                  :key="'result_' + j"
                  class="align-items-center mr-1 flex gap-1"
                >
                  <img
                    v-if="die.faces === 4"
                    src="@/assets/icons/d4.svg"
                    class="mt-1 h-6 w-6"
                    :alt="$t('infoModal.dieImage', { faces: 4 })"
                  />
                  <img
                    v-if="die.faces === 6"
                    src="@/assets/icons/d6.svg"
                    class="mt-1 h-6 w-6"
                    :alt="$t('infoModal.dieImage', { faces: 6 })"
                  />
                  <img
                    v-if="die.faces === 8"
                    src="@/assets/icons/d8.svg"
                    class="mt-1 h-6 w-6"
                    :alt="$t('infoModal.dieImage', { faces: 8 })"
                  />
                  <img
                    v-if="die.faces === 10"
                    src="@/assets/icons/d10.svg"
                    class="mt-1 h-6 w-6"
                    :alt="$t('infoModal.dieImage', { faces: 10 })"
                  />
                  <img
                    v-if="die.faces === 12"
                    src="@/assets/icons/d12.svg"
                    class="mt-1 h-6 w-6"
                    :alt="$t('infoModal.dieImage', { faces: 12 })"
                  />
                  <img
                    v-if="die.faces === 20"
                    src="@/assets/icons/d20.svg"
                    class="mt-1 h-6 w-6"
                    :alt="$t('infoModal.dieImage', { faces: 20 })"
                  />
                  <span>
                    {{ rollResultModal.options.roll?.isSecret ? '?' : result.result }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="m-auto">
            <div class="text-6xl">
              {{
                rollResultModal.options?.roll?.isSecret
                  ? '???'
                  : rollResultModal?.options?.roll?.total
              }}
            </div>
          </div>
        </div>
      </Modal>
    </Teleport>
  </div>
</template>