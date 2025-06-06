<script setup lang="ts">
import type { Actor } from '@/types/pf2e-types'
import { type Ref, onUnmounted, onMounted, type ComputedRef } from 'vue'
import { ref, provide, computed } from 'vue'
import { TabGroup, TabList, TabPanels } from '@headlessui/vue'
import { debounce } from 'lodash-es'

import { useWorld } from '@/composables/world'
import { useCharacter } from '@/composables/character'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'
import { useWindowSize } from '@vueuse/core'

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
import ActionsList from '@/components/ActionsList.vue'
import SpellList from '@/components/SpellList.vue'
import FeatsList from '@/components/FeatsList.vue'
import EquipmentList from '@/components/EquipmentList.vue'
import StrikeList from '@/components/StrikeList.vue'
import { useUserId } from '@/composables/user'

const props = defineProps(['characterId'])

// sheet layout and tab management
const { width } = useWindowSize()
const sideMenu = ref()
const panels = ref()

const currentTab = ref<number>()
const goLeft = ref(false)
function changeTab(index: number) {
  goLeft.value = (currentTab.value ?? 0) - index >= 0 ? true : false
  currentTab.value = index
}
const dragOptions = {
  preventWindowScrollY: true,
  lockDirection: true,
  swipeDistance: 100,
  axis: 'x'
}
const handleDrag = ({ swipe }: { swipe: [number, number] }) => {
  if (swipe[0]) changeTab(Math.max(0, Math.min((currentTab.value ?? 0) - swipe[0], 5)))
}

// base data
const { world } = useWorld()
const { userId } = useUserId()
const actor: Ref<Actor | undefined> = ref()
const actorOrWorldActor = computed(
  () => actor.value ?? world.value?.actors.find((a: Actor) => a._id == props.characterId)
)
const userHasActorPermission: ComputedRef<boolean> = computed(() => {
  if (
    actorOrWorldActor.value?.ownership === undefined ||
    actorOrWorldActor.value?.ownership?.[userId.value] === 3
  )
    return true
  else return false
})
const { character } = useCharacter(actorOrWorldActor)
provide(useKeys().characterKey, character)

// setup refresh methods
const { sendCharacterRequest, setupSocketListenersForActor, getCharUnsynced } = useApi()
const debouncededCharacterRequest = debounce(sendCharacterRequest, 500, { leading: true })
const requestCharacterDetails = async () => {
  getCharUnsynced().set(props.characterId, true)
  debouncededCharacterRequest(props.characterId)
}

// setup socket listeners and request character details on mount
onMounted(() => {
  console.log('TM-INIT: initiating character', props.characterId)
  if (props.characterId) {
    setupSocketListenersForActor(props.characterId, actor, requestCharacterDetails)
    sendCharacterRequest(props.characterId)
  }
  currentTab.value = width.value >= 768 ? 1 : 0
})
onUnmounted(() => {
  console.log('TM-INIT: unmounted actor', props.characterId)
})

defineExpose({ actor, character, actorOrWorldActor })
</script>
<template>
  <div class="flex h-dvh select-none" v-if="userHasActorPermission">
    <!-- show this column only if on a tablet or laptop -->
    <div class="border-divider hidden border-r md:block md:h-dvh md:w-80 md:overflow-auto">
      <CharacterHeader class="sticky top-0 z-10 h-32" />
      <FrontPage />
    </div>
    <!-- show this column on all devices -->
    <div
      v-drag="handleDrag"
      :dragOptions="dragOptions"
      class="border-divider no-scrollbar flex w-0 flex-1 flex-col justify-between md:h-dvh md:justify-start md:border-l"
    >
      <TabGroup :selectedIndex="currentTab" @change="changeTab">
        <TabPanels tabindex="-1" class="h-dvh w-full overflow-auto md:order-last" ref="panels">
          <CharacterHeader
            class="sticky top-0 z-10 h-32 md:hidden"
            @sidebar-activated="sideMenu.sidebarOpen = true"
          />
          <CharacterPanel :goLeft="goLeft" class="md:hidden">
            <FrontPage />
          </CharacterPanel>
          <CharacterPanel :goLeft="goLeft">
            <FeatsList />
          </CharacterPanel>
          <CharacterPanel :goLeft="goLeft">
            <Skills />
          </CharacterPanel>
          <CharacterPanel :goLeft="goLeft">
            <EquipmentList />
          </CharacterPanel>
          <CharacterPanel :goLeft="goLeft">
            <div class="lg:columns-2">
              <StrikeList />
              <ActionsList />
            </div>
          </CharacterPanel>
          <CharacterPanel :goLeft="goLeft">
            <SpellList />
          </CharacterPanel>
        </TabPanels>
        <TabList class="border-divider bottom-0 flex h-24 justify-around border-t border-b">
          <CharacterTab :src="cowled" label="Character" class="w-1/6 md:hidden" />
          <CharacterTab :src="biceps" label="Feats" class="w-1/6" />
          <CharacterTab :src="skills" label="Proficiencies" class="w-1/6" />
          <CharacterTab :src="backpack" label="Equipment" class="w-1/6" />
          <CharacterTab :src="leapfrog" label="Actions" class="w-1/6" />
          <CharacterTab :src="spellBook" label="Spells" class="w-1/6" />
          <Bars3Icon
            class="mx-4 my-auto hidden h-10 w-10 cursor-pointer rounded-md border-gray-900 p-1 text-gray-600 active:text-gray-300 md:block"
            @click="sideMenu.sidebarOpen = true"
          />
        </TabList>
      </TabGroup>
    </div>
    <SideMenu ref="sideMenu" />
  </div>
  <div v-else>User does not own this character</div>
</template>
