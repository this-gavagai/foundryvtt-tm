<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TransitionRoot, TransitionChild, Dialog, DialogPanel } from '@headlessui/vue'
import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  UsersIcon,
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
import { useChatStore } from '@/stores/chat'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import {
  triggerDismissHapticFeedback,
  triggerLightHapticFeedback
} from '@/composables/useHapticFeedback'
import { tokenPortrait } from '@/utils/tokenPortrait'

import Dropdown from '@/components/widgets/DropdownWidget.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import IconButtonWidget from '@/components/widgets/IconButtonWidget.vue'
import RollOptions from '@/components/RollOptions.vue'
import TokenArt from '@/components/TokenArt.vue'
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
const worldStore = useWorldStore()
const { world } = storeToRefs(worldStore)
const { worldAuthenticated } = storeToRefs(useFoundryWorldStatusStore())

const { t } = useI18n()
const connectionState = computed(() => {
  if (!isConnected.value) return 'down'
  if (!worldAuthenticated.value) return 'no-world'
  if (!isListening.value) return 'no-gm'
  return 'ok'
})
// Which Foundry user this device is signed in as. Worth naming in the status
// line because the app remembers a session across launches and can hold several
// servers, so "Connected" alone doesn't say connected as whom. Falls back to the
// bare label until the world payload arrives with the user list.
const currentUserName = computed(() => worldStore.userById(worldStore.world?.userId)?.name)
const connectionTitle = computed<Record<string, string>>(() => ({
  down: t('connection.down'),
  'no-world': t('connection.noWorld'),
  'no-gm': t('connection.noGm'),
  ok: currentUserName.value
    ? t('connection.connectedAs', { name: currentUserName.value })
    : t('connection.connected')
}))
const pixelStore = usePixelDiceStore()
const { pixels } = storeToRefs(pixelStore)
const { reconnectDie, forgetDie } = pixelStore

// Per-die icon — match the paired Pixel's actual die type to the shared
// faces-keyed icon map. The SDK's die types are strings like 'd6pipped' and
// 'd6fudge' (parseInt reads their face count through the suffix); 'd00'
// (percentile) maps to the d100 entry, which reuses the d10 asset. Unknown
// falls back to d20.
import { dieIcons } from '@/utils/chatRollDisplay'
function iconForDieType(dieType: string): string {
  if (dieType === 'd00') return dieIcons[100]
  return dieIcons[Number.parseInt(dieType.slice(1), 10)] ?? dieIcons[20]
}

// Detail modal — only opened when 2+ dice are paired; with a single die the
// inline row already shows everything. Ref-typed loosely because the Modal
// component is plain JS.
const pixelDiceModal = ref()
const targetHelperStore = useTargetHelperStore()
const { userList, targetingProxyId, proxyOffline } = storeToRefs(targetHelperStore)
const { updateProxyId } = targetHelperStore

// A pickable "none": mirroring someone's targeting has to be undoable, and the
// widget's own None is only a display fallback for an unmatched id, not an
// option. Without this entry a mis-tap here was permanent.
const proxyChoices = computed(() => [{ id: '', name: t('common.none') }, ...(userList.value ?? [])])

const targetProxySelector = ref()
const sidebarOpen = ref(false)

// Plain dismiss of the sidebar (backdrop, escape, X button). Fires a subtle
// tick. Menu items that close the sidebar as a side effect of an action keep
// their own click haptic instead.
function dismissSidebar() {
  triggerDismissHapticFeedback()
  sidebarOpen.value = false
}

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

// Character switcher — mirrors the header dropdown but as a side-menu modal.
// Resolves the owned-character ids to their world actors so the modal can show
// portrait + name; falls back to nothing while the world is still loading.
const characterSelectStore = useCharacterSelectStore()
const { characterList, openableActorIds, activeCharacterId } = storeToRefs(characterSelectStore)
const { setActiveCharacterId, openActor } = characterSelectStore

// Same derivation the sheets use, so a picker row shows the token art (and
// ring) that the header portrait will show once the row is tapped.
function pickerRow(id: string) {
  const actor = worldStore.actorById(id)
  if (!actor) return null
  return {
    _id: actor._id,
    name: actor.name,
    portrait: tokenPortrait(actor.prototypeToken, actor.img ?? undefined)
  }
}

const actorSearch = ref('')
const actorQuery = computed(() => actorSearch.value.trim().toLowerCase())
function matchesQuery(row: { name?: string | null }): boolean {
  return !actorQuery.value || !!row.name?.toLowerCase().includes(actorQuery.value)
}

// Top of the picker: the same owned-character list it has always shown.
const characterOptions = computed(() =>
  (characterList.value ?? []).flatMap((id) => pickerRow(id) ?? []).filter(matchesQuery)
)

// Below the divider: every actor this user may open, which for a GM is the
// whole roster including the npcs GM_LISTED_TYPES keeps out of the list above.
// Name-sorted so it reads as a roster to scroll rather than world order, and
// deliberately not deduplicated against the list above — the point of this
// section is that it is complete.
//
// Rendering all of it (hundreds of rows on a real world) is affordable because
// the rows lazy-load their art, and the ring rasters behind it are cached and
// size-bucketed for exactly this "dozens of rows ask at once" case.
const allActorOptions = computed(() =>
  openableActorIds.value
    .flatMap((id) => pickerRow(id) ?? [])
    .filter(matchesQuery)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
)

const characterPicker = ref<InstanceType<typeof Modal>>()
function openCharacterPicker() {
  sidebarOpen.value = false
  // A query left over from last time would hide the character list behind
  // results the user didn't ask for again.
  actorSearch.value = ''
  characterPicker.value?.open()
}
function selectCharacter(id: string | undefined) {
  triggerLightHapticFeedback()
  if (id) setActiveCharacterId(id)
  characterPicker.value?.close()
}
// Search results go through openActor rather than setActiveCharacterId: an npc
// isn't in characterList, so selecting it has to deep-link it in or no panel
// would render it.
function selectSearchedActor(id: string | undefined) {
  triggerLightHapticFeedback()
  if (id) openActor(id)
  characterPicker.value?.close()
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
      <Dialog as="div" class="relative z-50" @close="dismissSidebar">
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
                <div
                  data-part="sidebar-close"
                  class="absolute top-0 -left-16 flex w-16 justify-center pt-5"
                >
                  <button type="button" class="-m-2.5 p-2.5" @click="dismissSidebar">
                    <span class="sr-only">{{ $t('sideMenu.closeSidebar') }}</span>
                    <XMarkIcon class="h-6 w-6 text-white" aria-hidden="true" />
                  </button>
                </div>
              </TransitionChild>
              <div
                class="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4"
                data-part="panel"
                data-side-menu
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
                    <!-- Live status of whatever is already paired. Pairing
                         itself is in the settings modal, so with no dice paired
                         there is nothing to show here. -->
                    <li v-if="pixels.length">
                      <!-- Single die: full inline row (icon, name, battery, X).
                         The X stays mounted while the die reconnects so you
                         can always forget it — the spinner just sits next to
                         the X rather than replacing it. -->
                      <ul v-if="pixels.length === 1">
                        <li class="flex items-center gap-1">
                          <img :src="iconForDieType(pixels[0].dieType)" alt="" class="h-6 w-6" />
                          <button
                            type="button"
                            :title="$t('sideMenu.reconnectDie')"
                            class="grow cursor-pointer text-left"
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
                          </button>
                          <Spinner v-if="pixels[0].status === 'connecting'" class="h-6 w-6" />
                          <button
                            type="button"
                            class="cursor-pointer"
                            :aria-label="$t('sideMenu.forgetDie')"
                            @click="forgetDie(pixels[0].systemId)"
                          >
                            <XMarkIcon class="w-4" aria-hidden="true" />
                          </button>
                        </li>
                      </ul>
                      <!-- 2+ dice: just icons in a compact strip; clicking any
                         opens the detail modal where each die has the same
                         full row + always-visible X. -->
                      <div
                        v-else-if="pixels.length > 1"
                        class="flex flex-wrap items-center gap-2 pt-1"
                      >
                        <button
                          v-for="p in pixels"
                          :key="p.systemId"
                          type="button"
                          class="relative cursor-pointer"
                          :aria-label="p.name"
                          @click="pixelDiceModal.open()"
                        >
                          <img
                            :src="iconForDieType(p.dieType)"
                            alt=""
                            aria-hidden="true"
                            class="h-6 w-6"
                            :class="[
                              p.status === 'disconnected' ? 'opacity-40' : '',
                              p.status === 'connecting' ? 'animate-pulse opacity-60' : ''
                            ]"
                          />
                        </button>
                      </div>
                    </li>
                    <li>
                      <Button
                        class="w-full"
                        color="lightgray"
                        :clicked="openCharacterPicker"
                        :aria-label="$t('sideMenu.changeCharacter')"
                      >
                        <template #default>
                          <span class="inline-flex items-center justify-center gap-1">
                            <UsersIcon class="h-5 w-5" aria-hidden="true" />
                            <span class="whitespace-nowrap">{{
                              $t('sideMenu.changeCharacter')
                            }}</span>
                          </span>
                        </template>
                      </Button>
                    </li>
                    <li>
                      <div class="text-lg italic">{{ $t('sideMenu.targetingProxy') }}</div>
                      <Dropdown
                        ref="targetProxySelector"
                        :list="proxyChoices"
                        :selectedId="world === undefined ? 'loading' : (targetingProxyId ?? '')"
                        :changed="(newId: string) => updateProxyId(newId)"
                        :disabled="world === undefined"
                      />
                      <!-- A proxy whose client has left answers no target
                           report, so rolls quietly go out untargeted while its
                           name still sits in the picker. Say so. -->
                      <div v-if="proxyOffline" class="mt-1 text-sm text-amber-700 italic">
                        {{ $t('sideMenu.proxyOffline') }}
                      </div>
                    </li>
                    <li class="grow">
                      <RollOptions />
                    </li>
                    <li class="flex flex-col gap-3">
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
                        color="violet"
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
    <!-- Character switcher modal — lists every owned character so the user can
       jump to another sheet without using the header dropdown. -->
    <Modal ref="characterPicker" :title="$t('sideMenu.changeCharacter')">
      <div class="pt-3">
        <input
          v-model="actorSearch"
          data-part="actor-search"
          type="search"
          class="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
          :placeholder="$t('sideMenu.searchActors')"
        />
      </div>
      <!-- The owned-character list this modal has always shown. -->
      <ul v-if="characterOptions.length" class="flex flex-col gap-1 py-2">
        <li
          v-for="chr in characterOptions"
          :key="chr._id ?? undefined"
          data-part="character-option"
          :data-active="chr._id === activeCharacterId"
          class="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-gray-100"
          :class="chr._id === activeCharacterId ? 'bg-gray-100 font-semibold' : ''"
          @click="selectCharacter(chr._id ?? undefined)"
        >
          <div
            v-if="chr.portrait.url"
            class="flex h-10 w-10 flex-none items-center overflow-hidden rounded-full"
          >
            <TokenArt
              :url="chr.portrait.url"
              :scaleX="chr.portrait.scaleX"
              :scaleY="chr.portrait.scaleY"
              :ring="chr.portrait.ring"
              :px="40"
              :alt="chr.name ?? ''"
            />
          </div>
          <span class="truncate">{{ chr.name }}</span>
        </li>
      </ul>
      <div
        v-if="characterOptions.length && allActorOptions.length"
        data-part="picker-divider"
        class="border-divider border-t"
      ></div>
      <!-- Every actor this user may open, npcs included. Deliberately without a
           scroll container of its own: a nested one captures the gesture, so
           dragging over this list left the owned-character list above it pinned
           in place. The modal panel grows and ModalBox's outer overflow-y-auto
           scrolls the whole thing as one. -->
      <ul
        v-if="allActorOptions.length"
        data-part="all-actors"
        class="flex flex-col gap-1 py-2"
      >
        <li
          v-for="chr in allActorOptions"
          :key="chr._id ?? undefined"
          data-part="actor-result"
          :data-active="chr._id === activeCharacterId"
          class="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-gray-100"
          :class="chr._id === activeCharacterId ? 'bg-gray-100 font-semibold' : ''"
          @click="selectSearchedActor(chr._id ?? undefined)"
        >
          <div
            v-if="chr.portrait.url"
            class="flex h-10 w-10 flex-none items-center overflow-hidden rounded-full"
          >
            <TokenArt
              :url="chr.portrait.url"
              :scaleX="chr.portrait.scaleX"
              :scaleY="chr.portrait.scaleY"
              :ring="chr.portrait.ring"
              :px="40"
              :alt="chr.name ?? ''"
              lazy
            />
          </div>
          <span class="truncate">{{ chr.name }}</span>
        </li>
      </ul>
      <div
        v-if="!characterOptions.length && !allActorOptions.length"
        data-part="actor-search-empty"
        class="p-2 opacity-60"
      >
        {{ $t('sideMenu.noActorsFound') }}
      </div>
    </Modal>
    <!-- Detail view for paired Pixel dice. Mounted regardless of pixel count
       so toggling between 1- and 2-die states doesn't tear it down. -->
    <Modal ref="pixelDiceModal" :title="$t('sideMenu.pixelDice')">
      <ul class="flex flex-col gap-2 py-2">
        <li v-for="p in pixels" :key="p.systemId" class="flex items-center gap-2">
          <img :src="iconForDieType(p.dieType)" alt="" class="h-6 w-6" />
          <button
            type="button"
            :title="$t('sideMenu.reconnectDie')"
            class="grow cursor-pointer text-left"
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
          </button>
          <Spinner v-if="p.status === 'connecting'" class="h-6 w-6" />
          <button
            type="button"
            class="cursor-pointer"
            :aria-label="$t('sideMenu.forgetDie')"
            @click="forgetDie(p.systemId)"
          >
            <XMarkIcon class="w-4" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </Modal>
  </div>
</template>
