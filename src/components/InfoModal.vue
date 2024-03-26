<script setup lang="ts">
// TODO: (Big feature) Make modifiers for rolls alterable
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
import Modal from './Modal.vue'

const props = defineProps(['imageUrl', 'traits'])
const rollResultModal = ref()
const itemId = ref()
const options = ref()

const isOpen = ref(false)
function open(newItemId: string, newOptions: {} | null) {
  itemId.value = newItemId
  options.value = newOptions
  isOpen.value = true
}
function close() {
  itemId.value = null
  options.value = null
  isOpen.value = false
  emit('closing')
}

function swipeClose(item: any, i: any) {
  close()
}

const emit = defineEmits(['closing'])
defineExpose({ open, close, itemId, options, rollResultModal })
</script>
<template>
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
        <div class="flex bottom items-bottom justify-center p-0 pb-0 text-center">
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
              class="w-full max-w-md transform overflow-hidden bg-white p-6 text-left shadow-xl transition-all"
              v-touch:swipe.bottom="swipeClose"
            >
              <div class="max-h-[70vh] overflow-auto">
                <div class="flex space-x-2">
                  <div>
                    <img class="w-12" v-if="props.imageUrl" :src="getPath(props.imageUrl)" />
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
              <div class="mt-4 flex items-end justify-end gap-2 flex-wrap items-center">
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
            v-for="die in rollResultModal?.options?.roll.dice"
          >
            <div class="text-2xl">
              <span v-for="result in die.results"> {{ result.result }}&nbsp; </span>
            </div>
            <img src="@/assets/icons/dice-twenty-faces-twenty.svg" class="ml-1 h-6 w-6" />
          </div>
        </div>
        <div class="m-auto">
          <div class="text-6xl">{{ rollResultModal?.options?.roll.total }}</div>
        </div>
      </div>
    </Modal>
  </Teleport>
</template>
