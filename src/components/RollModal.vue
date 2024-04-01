<script setup lang="ts">
// TODO: remove socket for api interface
import { ref } from 'vue'
import { useServer } from '@/composables/server'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel, DialogTitle } from '@headlessui/vue'
import { SignedNumber } from '@/utils/utilities'

const { socket } = useServer()

const isOpen = ref(false)
const rollDetails = ref()
const hostUser = ref()

function openModal(rollApp: any, userId: string) {
  console.log(rollApp)
  rollDetails.value = rollApp
  hostUser.value = userId
  isOpen.value = true
}

function makeRoll() {
  isOpen.value = false
  socket.value.emit('module.tablemate', {
    action: 'rollConfirm',
    userId: hostUser.value,
    appId: rollDetails.value?.appId,
    roll: true
  })
}
function closeModal() {
  isOpen.value = false
  socket.value.emit('module.tablemate', {
    action: 'rollConfirm',
    userId: hostUser.value,
    appId: rollDetails.value?.appId,
    roll: false
  })
}

defineExpose({ openModal, closeModal })
</script>

<template>
  <TransitionRoot appear :show="isOpen" as="template">
    <Dialog as="div" @close="closeModal" class="relative z-10">
      <TransitionChild
        as="template"
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black bg-opacity-25" />
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
              class="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all"
            >
              <DialogTitle as="h3" class="text-lg font-medium leading-6 text-gray-900">
                {{ rollDetails.options.title }}
              </DialogTitle>
              <ul class="mt-2">
                <li
                  v-for="mod in rollDetails.check._modifiers"
                  :class="[mod.enabled ? 'text-black' : 'text-gray-300']"
                >
                  {{ mod.label }} {{ SignedNumber.format(mod.modifier) }}
                </li>
              </ul>

              <div class="mt-4">
                <button
                  type="button"
                  class="inline-flex justify-center rounded-md border border-transparent bg-blue-100 px-4 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  @click="makeRoll"
                >
                  Roll! ({{ SignedNumber.format(rollDetails.check.totalModifier) }})
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
@/composables/server
