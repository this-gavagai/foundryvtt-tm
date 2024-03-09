<script setup lang="ts">
import { ref, reactive, computed, inject } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogDescription,
  TransitionRoot,
  TransitionChild
} from '@headlessui/vue'
import { getPath } from '@/utils/utilities'
import { makeTraits, capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'
import { XMarkIcon } from '@heroicons/vue/24/outline'

export type InfoModalContent = {
  itemId?: string
  title?: string
  description?: string
  traits?: string[]
  body?: string
  iconPath?: string
  component?: any
  componentProps?: {}
  actionButtons?: [
    {
      buttonHtml?: string
      buttonClasses?: string
      buttonText?: string
      actionParams?: {}
      actionMethod?: any
    }
  ]
  toggleSet?: [
    {
      toggleText: string
      toggleTrigger: () => void
      toggleIsActive: () => boolean
    }
  ]
}

const props = defineProps(['imageUrl'])
const content: InfoModalContent = reactive({})
const itemId = ref()

const isOpen = ref(false)
function close() {
  // content.title =
  //   content.description =
  //   content.traits =
  //   content.body =
  //   content.iconPath =
  //   content.component =
  //   content.componentProps =
  //   content.actionButtons =
  //   content.toggleSet =
  //     undefined
  isOpen.value = false
}
function open(newValues: InfoModalContent, newItemId: string) {
  Object.assign(content, newValues)
  itemId.value = newItemId ?? content.itemId
  // itemId.value = content.itemId
  isOpen.value = true
  // compProps.value = newValues.componentProps
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
              <div
                class="flex basis-full justify-items-center empty:hidden border border-gray-400 cursor-pointer rounded-md w-full text-xs mb-2"
              >
                <div
                  v-for="t in content.toggleSet"
                  class="p-2 flex-auto border-l border-gray-300 first:border-none text-center"
                  @click="t?.toggleTrigger()"
                  :class="{ 'bg-gray-300': t.toggleIsActive() }"
                >
                  {{ t.toggleText }}
                </div>
              </div>
              <div class="max-h-[70vh] overflow-auto">
                <div class="flex space-x-2">
                  <div>
                    <img class="w-12" v-if="content.iconPath" :src="getPath(content.iconPath)" />
                    <img class="w-12" v-if="props.imageUrl" :src="getPath(props.imageUrl)" />
                  </div>
                  <div>
                    <DialogTitle as="h3" class="text-lg font-medium leading-6 text-gray-900">
                      {{ content.title }}
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
                      <div v-if="content.description" v-html="content.description"></div>
                      <slot name="description"></slot>
                    </DialogDescription>
                  </div>
                </div>
                <div
                  v-if="content.traits"
                  class="mt-2 text-sm [&_p]:my-2"
                  v-html="makeTraits(content.traits)"
                ></div>
                <div class="mt-2 text-sm [&_p]:my-2">
                  <div v-if="content.body" v-html="removeUUIDs(content.body)"></div>
                  <slot name="body"></slot>
                </div>
                <component :is="content.component" v-bind="content.componentProps"></component>
                <slot></slot>
              </div>
              <div class="mt-4 flex items-end justify-end gap-2">
                <button
                  v-for="b in content.actionButtons"
                  type="button"
                  class="inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
                  :class="b.buttonClasses"
                  @click="b.actionMethod(b.actionParams)"
                >
                  {{ b.buttonText }}
                </button>
                <slot name="actionButtons"></slot>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
