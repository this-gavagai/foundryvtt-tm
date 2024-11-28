<script setup lang="ts">
// TODO: (feature++) gather in macros for use here
import { ref, computed } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/24/solid'
import { useTargetHelper } from '@/composables/targetHelper'

import Dropdown from '@/components/DropdownWidget.vue'

const sidebarOpen = ref(false)
defineExpose({ sidebarOpen })
const { userList, targetingProxyId, updateProxyId } = useTargetHelper()
const proxyId = computed(() => {
  console.log('target changed!', targetingProxyId.value)
  return targetingProxyId.value
})
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
            <!-- Sidebar component, swap this element with another sidebar if you like -->
            <div class="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4">
              <nav class="flex flex-1 flex-col">
                <ul role="list" class="flex flex-1 flex-col gap-y-7 pt-4">
                  <li>
                    Targeting Proxy:
                    <!-- <Dropdown
                      :list="userList ?? []"
                      :selectedId="userList.find((i: any) => i.id === targetingProxyId)?.id ?? '0'"
                      @change="(newId: any) => updateProxyId(newId.id)"
                    /> -->
                    <Dropdown
                      :list="userList ?? []"
                      :selectedId="proxyId ?? '0'"
                      @change="(newId: any) => updateProxyId(newId.id)"
                    />
                  </li>
                  <li>
                    <ul role="list" class="-mx-2 space-y-1">
                      <li class="group flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6">
                        Custom macros will go here
                      </li>
                    </ul>
                  </li>
                  <!-- <li class="mt-auto">
                    <a
                      href="#"
                      class="group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6"
                    >
                      <Cog6ToothIcon class="h-6 w-6 shrink-0" aria-hidden="true" />
                      Settings
                    </a>
                  </li> -->
                </ul>
              </nav>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
