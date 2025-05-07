<script setup lang="ts">
import { ref } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/24/solid'
import { useTargetHelper } from '@/composables/targetHelper'
import { useWorld } from '@/composables/world'
import { usePixelDice } from '@/composables/pixelDice'

import Dropdown from '@/components/widgets/DropdownWidget.vue'
import RollOptions from '@/components/RollOptions.vue'
import Spinner from './widgets/SpinnerWidget.vue'

const { world } = useWorld()
const { pixelConnect, pixelReconnect, pixelDisconnect, pixel, pixelStatus } = usePixelDice()
const { userList, targetingProxyId, updateProxyId } = useTargetHelper()

const targetProxySelector = ref()
const sidebarOpen = ref(false)

defineExpose({ sidebarOpen })
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
              <div class="absolute top-0 -left-16 flex w-16 justify-center pt-5">
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
                  <li class="grow">
                    <RollOptions />
                  </li>
                  <li>
                    <div
                      class="cursor-pointer text-lg font-bold"
                      @click="
                        async () => {
                          await pixelConnect()
                        }
                      "
                    >
                      Pair Pixel Dice
                    </div>
                    <ul v-if="pixel">
                      <li class="flex gap-1">
                        <img src="@/assets/icons/d20.svg" class="h-6 w-6" />
                        <div
                          class="grow"
                          :class="[
                            pixelStatus === 'disconnected' ? 'line-through' : '',
                            pixelStatus === 'connecting' ? 'opacity-50' : ''
                          ]"
                          @click="pixelReconnect"
                        >
                          <span>{{ pixel.name }} </span>
                          (<span
                            :class="[pixel.batteryLevel < 30 ? 'text-red-700' : 'text-green-700']"
                            >{{ pixel.batteryLevel }}%</span
                          >)
                        </div>
                        <Spinner v-if="pixelStatus === 'connecting'" class="h-6 w-6" />
                        <XMarkIcon
                          v-else-if="pixelStatus === 'disconnected'"
                          class="w-4 cursor-pointer"
                          @click="pixelDisconnect"
                        />
                      </li>
                    </ul>
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
