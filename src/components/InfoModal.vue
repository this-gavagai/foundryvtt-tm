<script setup lang="ts">
import { ref, reactive } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'

type InfoModalContent = {
  title?: string
  description?: string
  body?: string
  iconPath?: string
  actionButtons?: [
    {
      buttonHtml?: string
      buttonClasses?: string
      buttonText?: string
      actionParams?: {}
      actionMethod?: any
    }
  ]
}
const content: InfoModalContent = reactive({})
const foundryUrl = new URL('http://192.168.2.148:30000/')

const isOpen = ref(false)
function close() {
  isOpen.value = false
}
function open(newValues: InfoModalContent) {
  Object.assign(content, newValues)
  isOpen.value = true
}

function swipeClose(item: any, i: any) {
  close()
}

defineExpose({ open, close })
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
                  <div v-if="content.iconPath">
                    <img class="w-12" :src="foundryUrl + content.iconPath" />
                  </div>
                  <div>
                    <DialogTitle
                      as="h3"
                      class="text-lg font-medium leading-6 text-gray-900"
                      v-html="content.title"
                    />
                    <DialogDescription v-html="content.description" />
                  </div>
                </div>
                <div class="mt-2 text-sm [&>p]:my-1" v-html="content.body"></div>
              </div>
              <div class="mt-4 flex items-end justify-end gap-2">
                <button
                  v-for="b in content.actionButtons"
                  type="button"
                  class="inline-flex justify-center items-end border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none"
                  :class="b.buttonClasses"
                  @click="b.actionMethod(b.actionParams)"
                >
                  {{ b.buttonText }}
                </button>
                <button
                  type="button"
                  class="inline-flex justify-center items-end border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none"
                  @click="close"
                >
                  Close
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
