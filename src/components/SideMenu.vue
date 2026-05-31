<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import { XMarkIcon } from '@heroicons/vue/24/solid'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useListenersStore } from '@/stores/listenersOnline'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useWorldStore } from '@/stores/world'
import { usePixelDiceStore } from '@/stores/pixelDice'
import { useSettingsStore } from '@/stores/settings'
import { availableLocales, setLocale } from '@/plugins/i18n'
import { useTheme, THEMES } from '@/composables/useTheme'

import Dropdown from '@/components/widgets/DropdownWidget.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import RollOptions from '@/components/RollOptions.vue'
import Spinner from './widgets/SpinnerWidget.vue'
import InfoModal from './InfoModal.vue'
import DamageRollModal from './DamageRollModal.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { freeRoll } from '@/api/actions'
import type { Roll } from '@/types/roll-types'

const { locale, t } = useI18n()
const { isConnected } = storeToRefs(useServerStore())
const { isListening } = storeToRefs(useListenersStore())
const { world, worldActive } = storeToRefs(useWorldStore())

const connectionState = computed(() => {
  if (!isConnected.value) return 'down'
  if (!worldActive.value) return 'no-world'
  if (!isListening.value) return 'no-gm'
  return 'ok'
})
const connectionTitle: Record<string, string> = {
  down: 'Foundry server not responding',
  'no-world': 'Server reachable — world not active',
  'no-gm': 'World active — no GM online',
  ok: 'Connected',
}
const pixelStore = usePixelDiceStore()
const { pixel, pixelStatus } = storeToRefs(pixelStore)
const { pixelConnect, pixelReconnect, pixelDisconnect } = pixelStore
const targetHelperStore = useTargetHelperStore()
const { userList, targetingProxyId } = storeToRefs(targetHelperStore)
const { updateProxyId } = targetHelperStore

const targetProxySelector = ref()
const sidebarOpen = ref(false)

const { activeTheme, setTheme } = useTheme()
const themeList = [
  { id: '', name: t('common.none') },
  ...THEMES.map((id) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }))
]

const { manualDicePicker } = storeToRefs(useSettingsStore())

const { _id: characterId } = useInjectedCharacter()
const freeRollModal = ref()
const isSecret = ref(false)

const freeRollRolls = computed<Roll[]>(() => [
  {
    key: 'free-roll',
    label: t('sideMenu.rollD20'),
    color: 'blue',
    dice: ['d20'],
    armed: true,
    execute: (faces?: number[]) =>
      freeRoll(characterId.value ?? '', isSecret.value, faces?.[0])
  }
])

function openFreeRoll() {
  sidebarOpen.value = false
  freeRollModal.value?.open()
}

const damageRollModal = ref<InstanceType<typeof DamageRollModal>>()
function openDamageRoll() {
  sidebarOpen.value = false
  damageRollModal.value?.open()
}

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
                  <span class="sr-only">{{ $t('sideMenu.closeSidebar') }}</span>
                  <XMarkIcon class="h-6 w-6 text-white" aria-hidden="true" />
                </button>
              </div>
            </TransitionChild>
            <div class="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4" data-part="panel">
              <nav class="flex flex-1 flex-col">
                <ul role="list" class="flex flex-1 flex-col gap-y-7 pt-4">
                  <li>
                    <div class="flex items-center gap-2">
                      <span
                        data-part="connection-dot"
                        :data-state="connectionState"
                        :class="{ 'animate-pulse': connectionState !== 'ok' }"
                        class="h-2.5 w-2.5 flex-none rounded-full"
                      />
                      <span class="text-sm">{{ connectionTitle[connectionState] }}</span>
                    </div>
                  </li>
                  <li>
                    <div class="text-lg italic">{{ $t('sideMenu.language') }}</div>
                    <Dropdown
                      :list="availableLocales"
                      :selectedId="locale"
                      :changed="(newId: string) => setLocale(newId)"
                    />
                  </li>
                  <li>
                    <div class="text-lg italic">{{ $t('sideMenu.theme') }}</div>
                    <Dropdown
                      :list="themeList"
                      :selectedId="activeTheme ?? ''"
                      :changed="(newId: string) => setTheme(newId || null)"
                    />
                  </li>
                  <li>
                    <Toggle
                      :active="manualDicePicker"
                      @changed="(v: boolean) => (manualDicePicker = v)"
                    >
                      <span class="text-lg italic">{{ $t('sideMenu.manualDicePicker') }}</span>
                    </Toggle>
                  </li>
                  <li>
                    <div class="text-lg italic">{{ $t('sideMenu.targetingProxy') }}</div>
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
                  <li class="flex flex-wrap gap-2">
                    <Button
                      :label="$t('sideMenu.freeRoll')"
                      color="blue"
                      :clicked="openFreeRoll"
                    />
                    <Button
                      :label="$t('sideMenu.damageRoll')"
                      color="red"
                      :clicked="openDamageRoll"
                    />
                  </li>
                  <li>
                    <div class="cursor-pointer text-lg font-bold" @click="pixelConnect">
                      {{ $t('sideMenu.pairPixelDice') }}
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
  <InfoModal ref="freeRollModal" :rolls="freeRollRolls">
    <template #title>{{ $t('sideMenu.freeRollTitle') }}</template>
    <template #beforeBody>
      <div class="mt-4">
        <Toggle :active="isSecret" @changed="(v: boolean) => (isSecret = v)">
          <span class="text-lg">{{ $t('sideMenu.secret') }}</span>
        </Toggle>
      </div>
    </template>
  </InfoModal>
  <DamageRollModal ref="damageRollModal" />
</template>
