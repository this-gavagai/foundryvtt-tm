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
import Modal from './ModalBox.vue'
import Spinner from './widgets/SpinnerWidget.vue'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'

import Button from './widgets/ButtonWidget.vue'

const { _id: characterId } = useInjectedCharacter()

const { pixel, lastRoll } = storeToRefs(usePixelDiceStore())
const { isListening } = storeToRefs(useListenersStore())

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

function executeRoll(roll: Roll, faces?: number[]) {
  if (roll.disabled) return
  return Promise.resolve(roll.execute(faces)).then(
    (r: RequestResolutionArgs | null | undefined) => {
      close(true)
      rollResultModal.value.open(r)
    }
  )
}

watch(lastRoll, () => {
  if (isOpen.value && armedRoll.value) executeRoll(armedRoll.value, [lastRoll.value!])
})

const isOpen = ref(false)
function open() {
  isOpen.value = true
  waiting.value = false
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
          <div class="fixed inset-0 bg-[#000A]" />
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
                    <div class="item-text">
                      <slot name="body"></slot>
                    </div>
                  </div>
                  <div>
                    <slot></slot>
                  </div>
                </div>
                <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <div
                    v-if="pixel && pixel.status === 'ready' && armedRoll?.dice?.length"
                    class="grow cursor-pointer"
                  >
                    <img
                      v-for="(die, i) in armedRoll.dice"
                      class="h-8 animate-bounce opacity-30"
                      src="@/assets/icons/d20.svg"
                      :key="i + '_' + die"
                    />
                  </div>
                  <slot name="actionButtons"></slot>
                  <Button
                    v-for="roll in props.rolls ?? []"
                    :key="roll.key"
                    :color="roll.color ?? 'blue'"
                    :disabled="roll.disabled"
                    :data-armed="roll.key === armedRoll?.key ? true : undefined"
                    :clicked="() => executeRoll(roll)"
                    >{{ roll.label }}</Button
                  >
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
<style>
.item-text table {
  border: 1px solid gray;
  margin-bottom: 10px;
}
.item-text table td,
.item-text table th {
  padding: 5px;
  border: 1px solid gray;
  min-width: 80px;
}
</style>
