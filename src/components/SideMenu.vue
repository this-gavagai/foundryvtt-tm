<script setup lang="ts">
import { ref, computed } from 'vue'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  XMarkIcon
} from '@heroicons/vue/24/solid'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useServerAddressStore } from '@/stores/serverAddress'
import { useListenersStore } from '@/stores/listenersOnline'
import { useTargetHelperStore } from '@/stores/targetHelper'
import { useWorldStore } from '@/stores/world'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { usePixelDiceStore } from '@/stores/pixelDice'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'

import Dropdown from '@/components/widgets/DropdownWidget.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import IconButtonWidget from '@/components/widgets/IconButtonWidget.vue'
import RollOptions from '@/components/RollOptions.vue'
import Spinner from './widgets/SpinnerWidget.vue'
import DamageRollBuilder from './DamageRollBuilder.vue'
import RollCheckBuilder from './RollCheckBuilder.vue'
import SettingsModal from './SettingsModal.vue'
import Modal from './ModalBox.vue'
import ChatOverlay from './ChatOverlay.vue'
import CompendiumBrowserOverlay from './CompendiumBrowserOverlay.vue'
import ServerSidebar from './ServerSidebar.vue'

const serverStore = useServerStore()
const { isConnected } = storeToRefs(serverStore)
const serverAddressStore = useServerAddressStore()
const { isListening } = storeToRefs(useListenersStore())
const { world } = storeToRefs(useWorldStore())
const { worldAuthenticated } = storeToRefs(useFoundryWorldStatusStore())

const connectionState = computed(() => {
  if (!isConnected.value) return 'down'
  if (!worldAuthenticated.value) return 'no-world'
  if (!isListening.value) return 'no-gm'
  return 'ok'
})
const connectionTitle: Record<string, string> = {
  down: 'Foundry server not responding',
  'no-world': 'Server reachable — world not active',
  'no-gm': 'World active — no GM online',
  ok: 'Connected'
}
const pixelStore = usePixelDiceStore()
const { pixels, pairError } = storeToRefs(pixelStore)
const { bluetoothSupported, pairDie, reconnectDie, forgetDie } = pixelStore

// Per-die icon — match the paired Pixel's actual die type to the in-app SVG.
// Variants of d6 (pipped/fudge) share the d6 icon; d00 (percentile) reuses
// d10 since we don't have a d100 asset. Unknown falls back to d20.
import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'
const dieTypeIcons: Record<string, string> = {
  d4: d4Icon,
  d6: d6Icon,
  d6pipped: d6Icon,
  d6fudge: d6Icon,
  d8: d8Icon,
  d10: d10Icon,
  d00: d10Icon,
  d12: d12Icon,
  d20: d20Icon
}
function iconForDieType(dieType: string): string {
  return dieTypeIcons[dieType] ?? d20Icon
}

// Detail modal — only opened when 2+ dice are paired; with a single die the
// inline row already shows everything. Ref-typed loosely because the Modal
// component is plain JS.
const pixelDiceModal = ref()
const targetHelperStore = useTargetHelperStore()
const { userList, targetingProxyId } = storeToRefs(targetHelperStore)
const { updateProxyId } = targetHelperStore

const targetProxySelector = ref()
const sidebarOpen = ref(false)

const { manualDicePicker } = storeToRefs(useSettingsStore())

const freeRollModal = ref<InstanceType<typeof RollCheckBuilder>>()
function openFreeRoll() {
  sidebarOpen.value = false
  freeRollModal.value?.open()
}

const damageRollModal = ref<InstanceType<typeof DamageRollBuilder>>()
function openDamageRoll() {
  sidebarOpen.value = false
  damageRollModal.value?.open()
}

const settingsModal = ref<InstanceType<typeof SettingsModal>>()
function openSettings() {
  sidebarOpen.value = false
  settingsModal.value?.open()
}

const chatStore = useChatStore()
const unreadBadge = computed(() =>
  chatStore.unreadCount > 99 ? '99+' : String(chatStore.unreadCount)
)

const chatOverlay = ref<InstanceType<typeof ChatOverlay>>()
function openChat() {
  sidebarOpen.value = false
  chatOverlay.value?.open()
}

const compendiumBrowser = ref<InstanceType<typeof CompendiumBrowserOverlay>>()
function openCompendium() {
  sidebarOpen.value = false
  compendiumBrowser.value?.open()
}

const serverSidebar = ref<InstanceType<typeof ServerSidebar>>()
function openServerManager() {
  sidebarOpen.value = false
  serverSidebar.value?.open()
}
// "Join a new server" from the manager: drop the live connection and return to
// the ServerUrlGate, pre-selected on its "New" option so the user can type a
// fresh address right away.
function joinNewServer() {
  serverStore.disconnect()
  serverAddressStore.requestNewServer()
}

defineExpose({ sidebarOpen, openChat, openCompendium })
</script>
<template>
  <div data-component="SideMenu">
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
              <div
                class="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4"
                data-part="panel"
              >
                <nav class="flex flex-1 flex-col">
                  <ul role="list" class="flex flex-1 flex-col gap-y-7 pt-4">
                    <li>
                      <div class="flex items-center gap-2">
                        <span
                          data-part="connection-dot"
                          :data-state="connectionState"
                          :class="[
                            { 'animate-pulse': connectionState !== 'ok' },
                            {
                              down: 'bg-[oklch(55%_0.18_25)]',
                              'no-world': 'bg-[oklch(72%_0.16_80)]',
                              'no-gm': 'bg-[oklch(72%_0.14_55)]',
                              ok: 'bg-[oklch(58%_0.16_145)]'
                            }[connectionState]
                          ]"
                          class="h-2.5 w-2.5 flex-none rounded-full"
                        />
                        <span class="text-sm">{{ connectionTitle[connectionState] }}</span>
                        <IconButtonWidget
                          data-part="settings-toggle"
                          class="ml-auto h-7 w-7 cursor-pointer text-gray-500 hover:text-gray-800 active:text-gray-400"
                          :label="$t('settings.title')"
                          @click="openSettings"
                        >
                          <Cog6ToothIcon aria-hidden="true" class="h-full w-full" />
                        </IconButtonWidget>
                      </div>
                    </li>
                    <li>
                      <Toggle
                        :active="manualDicePicker"
                        @changed="(v: boolean) => (manualDicePicker = v)"
                      >
                        <span class="text-lg italic">{{ $t('sideMenu.manualDicePicker') }}</span>
                      </Toggle>
                    </li>
                    <li class="-mt-4">
                      <div
                        class="text-lg font-bold"
                        :class="bluetoothSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
                        @click="pairDie"
                      >
                        {{ $t('sideMenu.pairPixelDice') }}
                      </div>
                      <div v-if="pairError" class="text-sm text-red-700">
                        {{ $t(pairError) }}
                      </div>
                      <!-- Single die: full inline row (icon, name, battery, X).
                         The X stays mounted while the die reconnects so you
                         can always forget it — the spinner just sits next to
                         the X rather than replacing it. -->
                      <ul v-if="pixels.length === 1">
                        <li class="flex items-center gap-1">
                          <img :src="iconForDieType(pixels[0].dieType)" class="h-6 w-6" />
                          <div
                            class="grow cursor-pointer"
                            :class="[
                              pixels[0].status === 'disconnected' ? 'line-through' : '',
                              pixels[0].status === 'connecting' ? 'opacity-50' : ''
                            ]"
                            @click="reconnectDie(pixels[0].systemId)"
                          >
                            <span>{{ pixels[0].name }} </span>
                            (<span
                              :class="[
                                pixels[0].batteryLevel < 30 ? 'text-red-700' : 'text-green-700'
                              ]"
                              >{{ pixels[0].batteryLevel }}%</span
                            >)
                          </div>
                          <Spinner v-if="pixels[0].status === 'connecting'" class="h-6 w-6" />
                          <XMarkIcon
                            class="w-4 cursor-pointer"
                            @click="forgetDie(pixels[0].systemId)"
                          />
                        </li>
                      </ul>
                      <!-- 2+ dice: just icons in a compact strip; clicking any
                         opens the detail modal where each die has the same
                         full row + always-visible X. -->
                      <div
                        v-else-if="pixels.length > 1"
                        class="flex flex-wrap items-center gap-2 pt-1"
                      >
                        <div
                          v-for="p in pixels"
                          :key="p.systemId"
                          class="relative cursor-pointer"
                          @click="pixelDiceModal.open()"
                        >
                          <img
                            :src="iconForDieType(p.dieType)"
                            class="h-6 w-6"
                            :class="[
                              p.status === 'disconnected' ? 'opacity-40' : '',
                              p.status === 'connecting' ? 'animate-pulse opacity-60' : ''
                            ]"
                          />
                        </div>
                      </div>
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
                    <li class="flex flex-col gap-3">
                      <Button
                        class="w-full"
                        color="green"
                        :clicked="openChat"
                        :aria-label="$t('sideMenu.chat')"
                      >
                        <template #default>
                          <span class="inline-flex items-center justify-center gap-1">
                            <ChatBubbleLeftRightIcon class="h-5 w-5" aria-hidden="true" />
                            <span class="whitespace-nowrap">{{ $t('sideMenu.chat') }}</span>
                            <span
                              v-if="chatStore.unreadCount"
                              data-part="chat-unread-badge"
                              class="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white"
                              :aria-label="
                                $t('chat.unreadMessages', { count: chatStore.unreadCount })
                              "
                            >
                              {{ unreadBadge }}
                            </span>
                          </span>
                        </template>
                      </Button>
                      <div class="flex gap-2">
                        <Button
                          class="flex-1"
                          :label="$t('sideMenu.freeRoll')"
                          color="blue"
                          :clicked="openFreeRoll"
                        />
                        <Button
                          class="flex-1"
                          :label="$t('sideMenu.damageRoll')"
                          color="red"
                          :clicked="openDamageRoll"
                        />
                      </div>
                      <Button
                        class="w-full"
                        color="lightgray"
                        :clicked="openCompendium"
                        :aria-label="$t('sideMenu.compendium')"
                      >
                        <template #default>
                          <span class="inline-flex items-center justify-center gap-1">
                            <BookOpenIcon class="h-5 w-5" aria-hidden="true" />
                            <span class="whitespace-nowrap">{{ $t('sideMenu.compendium') }}</span>
                          </span>
                        </template>
                      </Button>
                    </li>
                  </ul>
                </nav>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>
    <RollCheckBuilder ref="freeRollModal" />
    <DamageRollBuilder ref="damageRollModal" />
    <SettingsModal ref="settingsModal" @manage-servers="openServerManager" />
    <ChatOverlay ref="chatOverlay" />
    <CompendiumBrowserOverlay ref="compendiumBrowser" />
    <ServerSidebar ref="serverSidebar" @join="joinNewServer" />
    <!-- Detail view for paired Pixel dice. Mounted regardless of pixel count
       so toggling between 1- and 2-die states doesn't tear it down. -->
    <Modal ref="pixelDiceModal" :title="$t('sideMenu.pixelDice')">
      <ul class="flex flex-col gap-2 py-2">
        <li v-for="p in pixels" :key="p.systemId" class="flex items-center gap-2">
          <img :src="iconForDieType(p.dieType)" class="h-6 w-6" />
          <div
            class="grow cursor-pointer"
            :class="[
              p.status === 'disconnected' ? 'line-through' : '',
              p.status === 'connecting' ? 'opacity-50' : ''
            ]"
            @click="reconnectDie(p.systemId)"
          >
            <span>{{ p.name }} </span>
            (<span :class="[p.batteryLevel < 30 ? 'text-red-700' : 'text-green-700']"
              >{{ p.batteryLevel }}%</span
            >)
          </div>
          <Spinner v-if="p.status === 'connecting'" class="h-6 w-6" />
          <XMarkIcon class="w-4 cursor-pointer" @click="forgetDie(p.systemId)" />
        </li>
      </ul>
    </Modal>
  </div>
</template>
