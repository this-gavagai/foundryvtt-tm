<script setup lang="ts">
import { ref } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'
import { getPath } from '@/utils/utilities'
import { makeTraits } from '@/utils/utilities'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import Modal from './ModalBox.vue'

const props = defineProps(['imageUrl', 'traits'])
const rollResultModal = ref()
const itemId = ref()
const options = ref()

const isOpen = ref(false)
function open(newItemId: string = '', newOptions: object | null = null) {
  itemId.value = newItemId
  options.value = newOptions
  isOpen.value = true
}
function close() {
  isOpen.value = false
  setTimeout(() => {
    itemId.value = null
    options.value = null
  }, 500)
  emit('closing')
}

const emit = defineEmits(['closing'])
defineExpose({ open, close, itemId, options, rollResultModal })
</script>
<template>
  <div class="touch-manipulation">
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
          <div class="fixed inset-0 bg-black bg-opacity-25" />
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
                class="w-full max-w-4xl transform overflow-hidden bg-white p-6 text-left shadow-xl transition-all"
              >
                <div class="max-h-[70vh] overflow-auto">
                  <div class="flex space-x-2">
                    <div class="bg-gray-300">
                      <img
                        class="h-12 w-12"
                        v-if="props.imageUrl"
                        :src="getPath(props.imageUrl)"
                        alt="PF2e system icon"
                      />
                    </div>
                    <div>
                      <DialogTitle as="h3" class="text-lg font-medium leading-6 text-gray-900">
                        <slot name="title"></slot>
                      </DialogTitle>
                      <div class="absolute right-0 top-0 pr-4 pt-4 sm:block">
                        <button
                          type="button"
                          class="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none"
                          @click="close"
                        >
                          <span class="sr-only">Close</span>
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
                    <slot name="body"></slot>
                  </div>
                  <div>
                    <slot></slot>
                  </div>
                </div>
                <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
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
            <div class="m-auto">{{ rollResultModal?.options?.roll.formula }}</div>
            <div
              class="flex items-center justify-center"
              v-for="(die, i) in rollResultModal?.options?.roll.dice"
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
                    alt="d4 image"
                  />
                  <img
                    v-if="die.faces === 6"
                    src="@/assets/icons/d6.svg"
                    class="mt-1 h-6 w-6"
                    alt="d6 image"
                  />
                  <img
                    v-if="die.faces === 8"
                    src="@/assets/icons/d8.svg"
                    class="mt-1 h-6 w-6"
                    alt="d8 image"
                  />
                  <img
                    v-if="die.faces === 10"
                    src="@/assets/icons/d10.svg"
                    class="mt-1 h-6 w-6"
                    alt="d10 image"
                  />
                  <img
                    v-if="die.faces === 12"
                    src="@/assets/icons/d12.svg"
                    class="mt-1 h-6 w-6"
                    alt="d12 image"
                  />
                  <img
                    v-if="die.faces === 20"
                    src="@/assets/icons/d20.svg"
                    class="mt-1 h-6 w-6"
                    alt="d20 image"
                  />
                  <span>
                    {{ rollResultModal.options.roll.isSecret ? '?' : result.result }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="m-auto">
            <div class="text-6xl">
              {{
                rollResultModal.options.roll.isSecret ? '???' : rollResultModal?.options?.roll.total
              }}
            </div>
          </div>
        </div>
      </Modal>
    </Teleport>
  </div>
</template>
