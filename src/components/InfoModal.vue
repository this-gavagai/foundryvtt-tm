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

const props = defineProps(['imageUrl', 'traits'])
const itemId = ref()

const isOpen = ref(false)
function open(newItemId: string) {
  itemId.value = newItemId
  isOpen.value = true
}
function close() {
  itemId.value = null
  isOpen.value = false
}

function swipeClose(item: any, i: any) {
  close()
}

defineExpose({ open, close, itemId })
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
              <div class="mt-4 flex items-end justify-end gap-2">
                <slot name="actionButtons"></slot>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
