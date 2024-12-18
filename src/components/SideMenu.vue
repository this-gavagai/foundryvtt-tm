<script setup lang="ts">
import { ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/24/solid'
import { useTargetHelper } from '@/composables/targetHelper'
import { useWorld } from '@/composables/world'

import Dropdown from '@/components/DropdownWidget.vue'
import RollOptions from '@/components/RollOptions.vue'

const targetProxySelector = ref()
const sidebarOpen = ref(false)
defineExpose({ sidebarOpen })
const { userList, targetingProxyId, updateProxyId } = useTargetHelper()
const { world } = useWorld()
// watch(targetingProxyId, () => {
//   console.log('TM-info', targetingProxyId, userList)
//   targetProxySelector.value.selected = userList.value?.find((u) => u.id === targetingProxyId.value)
// })
</script>
<template>
  <TransitionRoot as="template" :show="sidebarOpen">
    <Dialog as="div" class="relative z-50" @close="sidebarOpen = false">
      <TransitionChild
        as="template"
        enter="transition-opacity ease-linear duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="transition-opacity ease-linear duration-300"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-gray-900/80" />
      </TransitionChild>

      <div class="fixed inset-0 flex justify-end">
        <!-- <TransitionChild
        as="template"
        enter="transition ease-in-out duration-300 transform"
        enter-from="-translate-x-full"
        enter-to="translate-x-0"
        leave="transition ease-in-out duration-300 transform"
        leave-from="translate-x-0"
        leave-to="-translate-x-full"
      > -->
        <TransitionChild
          as="template"
          enter="transition ease-in-out duration-300 transform"
          enter-from="translate-x-full"
          enter-to="translate-x-0"
          leave="transition ease-in-out duration-300 transform"
          leave-from="translate-x-0"
          leave-to="translate-x-full"
        >
          <DialogPanel class="relative ml-16 flex w-full max-w-xs flex-1">
            <TransitionChild
              as="template"
              enter="ease-in-out duration-300"
              enter-from="opacity-0"
              enter-to="opacity-100"
              leave="ease-in-out duration-300"
              leave-from="opacity-100"
              leave-to="opacity-0"
            >
              <div class="absolute -left-16 top-0 flex w-16 justify-center pt-5">
                <button type="button" class="-m-2.5 p-2.5" @click="sidebarOpen = false">
                  <span class="sr-only">Close sidebar</span>
                  <XMarkIcon class="h-6 w-6 text-white" aria-hidden="true" />
                </button>
              </div>
            </TransitionChild>
            <div class="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4">
              <nav class="flex flex-1 flex-col">
                <ul role="list" class="flex flex-1 flex-col gap-y-7 pt-4">
                  <li>
                    <div class="text-lg italic">Targeting Proxy</div>
                    <Dropdown
                      ref="targetProxySelector"
                      :list="userList ?? []"
                      :selectedId="world === undefined ? 'loading' : (targetingProxyId ?? '0')"
                      :changed="(newId: string) => updateProxyId(newId)"
                      :disabled="world === undefined"
                    />
                  </li>
                  <li>
                    <RollOptions />
                  </li>
                </ul>
              </nav>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
