<script setup lang="ts">
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateActor, TablemateCharacter, TablemateFamiliar } from '@/types/character-types'
import type { Ref, ComputedRef } from 'vue'
import { ref, provide, computed, onMounted, watch } from 'vue'
import { TabGroup, TabList, TabPanels } from '@headlessui/vue'

import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { useServerStore } from '@/stores/server'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import { useCharacter } from '@/composables/character'
import { useActorSync } from '@/composables/useActorSync'
import { characterKey } from '@/composables/injectKeys'
import { useWindowSize } from '@vueuse/core'
import { useUserStore } from '@/stores/user'

import { Bars3Icon } from '@heroicons/vue/24/solid'

import cowled from '@/assets/icons/cowled.svg'
import biceps from '@/assets/icons/biceps.svg'
import backpack from '@/assets/icons/swap-bag-2.svg'
import leapfrog from '@/assets/icons/leapfrog.svg'
import spellBook from '@/assets/icons/spell-book.svg'
import skills from '@/assets/icons/skills.svg'

import SideMenu from '@/components/SideMenu.vue'
import CharacterHeader from '@/components/CharacterHeader.vue'
import CharacterTab from '@/components/CharacterTab.vue'
import CharacterPanel from './CharacterPanel.vue'
import FrontPage from '@/components/FrontPage.vue'
import Skills from '@/components/SkillList.vue'
import SpellList from '@/components/SpellList.vue'
import FeatsList from '@/components/FeatsList.vue'
import EquipmentList from '@/components/EquipmentList.vue'
import ActionsPanel from '@/components/ActionsPanel.vue'
import FamiliarSheet from '@/components/FamiliarSheet.vue'

const props = defineProps(['characterId'])

// Single source of truth for the tab bar + panels. Order defines
// both the tab index and the panel order. `mobileOnly` tabs are hidden at
// md+ (their content lives in the always-visible left sidebar instead).
const tabs = [
  { icon: cowled, label: 'tabs.character', content: FrontPage, mobileOnly: true },
  { icon: biceps, label: 'tabs.feats', content: FeatsList },
  { icon: skills, label: 'tabs.proficiencies', content: Skills },
  { icon: backpack, label: 'tabs.equipment', content: EquipmentList },
  { icon: leapfrog, label: 'tabs.actions', content: ActionsPanel },
  { icon: spellBook, label: 'tabs.spells', content: SpellList }
]
// First tab the user can actually land on at md+ (mobileOnly tabs are hidden).
const firstDesktopTab = tabs.findIndex((t) => !t.mobileOnly)

// sheet layout and tab management
const { width } = useWindowSize()
const sideMenu = ref()
const panels = ref()

const characterSelectStore = useCharacterSelectStore()
const { activeSheetTab } = storeToRefs(characterSelectStore)
const { initializeActiveSheetTab, setActiveSheetTab } = characterSelectStore
const goLeft = ref(false)
function changeTab(index: number) {
  goLeft.value = (activeSheetTab.value ?? 0) - index >= 0 ? true : false
  setActiveSheetTab(index)
}
// base data
const { world } = storeToRefs(useWorldStore())
const { userId } = storeToRefs(useUserStore())
const { sessionReady } = storeToRefs(useServerStore())
const actor: Ref<TablemateActor | undefined> = ref()
// The actor as known to the *current* world — authoritative for this session,
// and the only source we trust for the ownership/access check below.
const worldActor = computed<TablemateActor | undefined>(
  () =>
    world.value?.actors?.find<CharacterPF2e<null>>((a) => a._id == props.characterId) as
      | TablemateActor
      | undefined
)
const actorOrWorldActor = computed<TablemateActor | undefined>(
  () => actor.value ?? worldActor.value
)
const characterActor = computed<TablemateCharacter | undefined>(() =>
  actorOrWorldActor.value?.type === 'character'
    ? (actorOrWorldActor.value as TablemateCharacter)
    : undefined
)
const familiarActor = computed<TablemateFamiliar | undefined>(() =>
  actorOrWorldActor.value?.type === 'familiar'
    ? (actorOrWorldActor.value as TablemateFamiliar)
    : undefined
)
// Ownership is decided strictly from the current world, never from `actor`.
// `actor` may be a locally-cached IndexedDB snapshot left over from a *different*
// server (the URL's stale ?id= keeps such a sheet mounted until the new world
// loads); checking the new user against that snapshot's ownership produced a
// spurious "userDoesNotOwnCharacter" flash. Until the world confirms the actor
// we assume permission and paint optimistically from whatever data we have.
const userHasActorPermission: ComputedRef<boolean> = computed(() => {
  const ownership = worldActor.value?.ownership
  if (ownership === undefined || ownership[userId.value] === 3) return true
  else return false
})
const accessDenied: ComputedRef<boolean> = computed(
  () => sessionReady.value && !!worldActor.value && !userHasActorPermission.value
)
const { character } = useCharacter(characterActor)
provide(characterKey, character)

// keep the local actor ref synced with Foundry via socket events
useActorSync(props.characterId, actor)

// Fade the whole sheet in once the actor's data has landed, rather than letting
// each piece pop in as the cache snapshot (then the live fetch) hydrates. While
// the data is still absent the root sits at opacity-0, so any incremental
// rendering / layout settling is hidden; the moment data is present it fades in
// as a single unit. Sticky so a later transient undefined never fades it back out.
const contentReady = ref(false)
watch(
  actorOrWorldActor,
  (a) => {
    if (a) contentReady.value = true
  },
  { immediate: true }
)

// set initial tab based on viewport
onMounted(() => {
  initializeActiveSheetTab(width.value >= 768 ? firstDesktopTab : 0)
})

defineExpose({ actor, character, actorOrWorldActor })
</script>
<template>
  <div
    class="flex h-full min-h-0 overflow-hidden transition-opacity duration-200 ease-out select-none"
    :class="contentReady ? 'opacity-100' : 'opacity-0'"
    v-if="userHasActorPermission"
  >
    <FamiliarSheet v-if="familiarActor" :actor="familiarActor" />
    <template v-else>
      <!-- show this column only if on a tablet or laptop -->
      <div
        data-part="sheet-left"
        class="border-divider app-scroll hidden border-r md:block md:h-full md:w-80"
      >
        <CharacterHeader class="sticky top-0 z-10 h-32" @chat-activated="sideMenu.openChat()" />
        <FrontPage />
      </div>
      <!-- show this column on all devices -->
      <div
        data-part="sheet-right"
        class="border-divider no-scrollbar flex h-full min-h-0 w-0 flex-1 flex-col overflow-hidden md:justify-start md:border-l"
      >
        <TabGroup
          :selectedIndex="activeSheetTab"
          @change="changeTab"
          as="div"
          class="flex min-h-0 flex-1 flex-col"
        >
          <TabPanels tabindex="-1" class="app-scroll w-full flex-1 md:order-last" ref="panels">
            <CharacterHeader
              class="sticky top-0 z-10 h-32 md:hidden"
              @sidebar-activated="sideMenu.sidebarOpen = true"
              @chat-activated="sideMenu.openChat()"
            />
            <CharacterPanel
              v-for="tab in tabs"
              :key="tab.label"
              :goLeft="goLeft"
              :class="{ 'md:hidden': tab.mobileOnly }"
            >
              <component :is="tab.content" />
            </CharacterPanel>
          </TabPanels>
          <TabList
            data-part="tab-bar"
            class="border-divider bottom-0 flex h-24 flex-none justify-around border-t border-b bg-white"
          >
            <CharacterTab
              v-for="tab in tabs"
              :key="tab.label"
              :src="tab.icon"
              :label="$t(tab.label)"
              class="w-1/6"
              :class="{ 'md:hidden': tab.mobileOnly }"
            />
            <Bars3Icon
              data-part="sidebar-toggle"
              class="mx-4 my-auto hidden h-10 w-10 cursor-pointer rounded-md p-1 text-gray-700 transition-colors hover:bg-gray-100 active:bg-gray-300 md:block"
              @click="sideMenu.sidebarOpen = true"
            />
          </TabList>
        </TabGroup>
      </div>
      <SideMenu ref="sideMenu" />
    </template>
  </div>
  <div v-else-if="accessDenied">{{ $t('app.userDoesNotOwnCharacter') }}</div>
</template>
