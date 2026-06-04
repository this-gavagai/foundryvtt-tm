<script setup lang="ts">
import { ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'

import { XMarkIcon } from '@heroicons/vue/24/outline'
import { InformationCircleIcon } from '@heroicons/vue/24/solid'

// `zIndexClass` overrides the outer Dialog's stacking class so a Modal
// opened on top of another Headless UI Dialog (e.g. SideMenu, which uses
// z-50) can sit above it. Default of `z-10` keeps existing callers
// unchanged.
const props = defineProps({
  title: { type: String, default: undefined },
  focusTarget: { type: [Object, Function], default: undefined },
  infoButton: { type: Function, default: undefined },
  noX: { type: Boolean, default: false },
  zIndexClass: { type: String, default: 'z-10' }
})
const isOpen = ref(false)
const content = ref()
const options = ref()
const xButton = ref()

function open(newOptions = null) {
  isOpen.value = true
  options.value = newOptions
}
function close() {
  isOpen.value = false
  // options.value = null
}
defineExpose({ open, close, options, isOpen })
</script>

<template>
  <TransitionRoot appear :show="isOpen" as="template">
    <Dialog
      as="div"
      @close="close"
      class="relative touch-manipulation"
      :class="props.zIndexClass"
      :initial-focus="props.focusTarget ?? xButton"
    >
      <TransitionChild
        as="template"
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/25" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4 text-center">
          <TransitionChild
            as="template"
            enter="duration-300 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel
              data-part="panel"
              class="relative w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all"
            >
              <DialogTitle
                as="h3"
                class="flex items-center gap-1 text-lg leading-6 font-medium text-gray-900"
              >
                {{ props.title }}
                <InformationCircleIcon
                  class="h-5 w-5"
                  v-if="props.infoButton"
                  @click="props.infoButton()"
                />
              </DialogTitle>
              <div class="absolute top-0 right-0 pt-4 pr-4 sm:block">
                <button
                  data-part="close"
                  class="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-hidden"
                  @click="close"
                  type="button"
                  ref="xButton"
                >
                  <span class="sr-only">{{ $t('common.close') }}</span>
                  <XMarkIcon class="h-6 w-6" aria-hidden="true" v-if="!noX" />
                </button>
              </div>
              <div ref="content">
                <slot></slot>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
