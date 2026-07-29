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
import { useOverlayStack } from '@/composables/useOverlayStack'
import {
  triggerDismissHapticFeedback,
  triggerLightHapticFeedback
} from '@/composables/useHapticFeedback'

// Minimal confirmation modal. Renders as a themed [data-part='panel'] inside a
// [role='dialog'], so it inherits the app's modal surface + text colors on every
// theme; the buttons use theme-agnostic colors (red for a danger confirm, a
// ghost cancel that inherits the panel text) so no per-theme CSS is needed.
defineProps<{
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const isOpen = ref(false)
const { zIndex, openLayer, closeLayer } = useOverlayStack()

function open() {
  openLayer()
  isOpen.value = true
}
function close() {
  isOpen.value = false
  closeLayer()
}
function onConfirm() {
  triggerLightHapticFeedback()
  emit('confirm')
  close()
}
function onCancel() {
  triggerDismissHapticFeedback()
  emit('cancel')
  close()
}

defineExpose({ open, close, isOpen })
</script>

<template>
  <TransitionRoot appear :show="isOpen" as="template">
    <Dialog as="div" class="relative touch-manipulation" :style="{ zIndex }" @close="onCancel">
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/40" />
      </TransitionChild>

      <div class="fixed inset-0 flex items-center justify-center p-4">
        <TransitionChild
          as="template"
          enter="duration-200 ease-out"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="duration-150 ease-in"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel
            data-component="ConfirmDialog"
            data-part="panel"
            class="w-full max-w-sm rounded-lg bg-white p-5 text-left shadow-xl"
          >
            <DialogTitle as="h3" class="text-base font-semibold">
              {{ title }}
            </DialogTitle>
            <DialogDescription v-if="message" class="mt-1.5 text-sm opacity-80">
              {{ message }}
            </DialogDescription>
            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                data-part="confirm-cancel"
                class="rounded-md px-3 py-2 text-sm font-medium opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden"
                @click="onCancel"
              >
                {{ cancelLabel }}
              </button>
              <button
                type="button"
                data-part="confirm-accept"
                class="rounded-md px-3 py-2 text-sm font-semibold text-white transition-colors focus:outline-hidden"
                :class="
                  danger
                    ? 'bg-red-600 hover:bg-red-500 active:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700'
                "
                @click="onConfirm"
              >
                {{ confirmLabel }}
              </button>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
