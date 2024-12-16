<script setup lang="ts">
// TODO (feature): add swipe gestures (to change tab, for example)
import type { Actor } from '@/types/pf2e-types'
import { type Ref, onUnmounted, onMounted } from 'vue'
import { ref, provide, computed } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'
import { debounce } from 'lodash-es'
import { useWorld } from '@/composables/world'
import { useCharacter } from '@/composables/character'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'
import { useWindowSize } from '@vueuse/core'

import { Bars3Icon } from '@heroicons/vue/24/solid'

import cowled from '@/assets/icons/cowled.svg'
import biceps from '@/assets/icons/biceps.svg'
import backpack from '@/assets/icons/knapsack.svg'
import leapfrog from '@/assets/icons/leapfrog.svg'
import spellBook from '@/assets/icons/spell-book.svg'
import skills from '@/assets/icons/skills.svg'

import SideMenu from '@/components/SideMenu.vue'
import CharacterTab from '@/components/CharacterTab.vue'
import CharacterHeader from '@/components/CharacterHeader.vue'
import FrontPage from '@/components/FrontPage.vue'
import Skills from '@/components/SkillList.vue'
import ActionsList from '@/components/ActionsList.vue'
import SpellList from '@/components/SpellList.vue'
import FeatsList from '@/components/FeatsList.vue'
import EquipmentList from '@/components/EquipmentList.vue'
import StrikeList from '@/components/StrikeList.vue'

const { width } = useWindowSize()
const props = defineProps(['characterId'])
const sideMenu = ref()
const panels = ref()

// base data
const { world } = useWorld()
const actor: Ref<Actor | undefined> = ref()
const bestActorAvailable = computed(
  () => actor.value ?? world.value?.actors.find((a: Actor) => a._id == props.characterId)
)
const { character } = useCharacter(bestActorAvailable)
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
})
onUnmounted(() => {
  console.log('TM-INIT: unmounted actor', props.characterId)
})
defineExpose({ actor, character })
</script>
<template>
  <div class="flex h-dvh select-none">
    <!-- show this column only if on a tablet or laptop -->
    <div class="hidden border-r md:block md:h-dvh md:w-80 md:overflow-auto">
      <CharacterHeader class="sticky top-0 z-10 h-32 bg-white" />
      <FrontPage />
    </div>
    <!-- show this column on all devices -->
    <div class="flex w-0 flex-1 flex-col justify-between md:h-dvh md:justify-start md:border-l">
      <TabGroup :defaultIndex="width >= 768 ? 1 : 0" @change="panels.$el.scrollTop = 0">
        <TabPanels tabindex="-1" class="overflow-auto md:order-last" ref="panels">
          <CharacterHeader class="sticky top-0 z-10 h-32 w-full bg-white md:hidden" />
          <TabPanel tabindex="-1" class="md:hidden">
            <FrontPage />
          </TabPanel>
          <TabPanel tabindex="-1">
            <FeatsList />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Skills />
          </TabPanel>
          <TabPanel tabindex="-1">
            <EquipmentList />
          </TabPanel>
          <TabPanel tabindex="-1">
            <div class="lg:columns-2">
              <StrikeList />
              <ActionsList />
            </div>
          </TabPanel>
          <TabPanel tabindex="-1">
            <SpellList />
          </TabPanel>
        </TabPanels>
        <TabList class="flex justify-around border-t md:border-b">
          <CharacterTab :src="cowled" label="Character" class="md:hidden" />
          <CharacterTab :src="biceps" label="Feats" />
          <CharacterTab :src="skills" label="Proficiencies" />
          <CharacterTab :src="backpack" label="Equipment" />
          <CharacterTab :src="leapfrog" label="Actions" />
          <CharacterTab :src="spellBook" label="Spells" />
          <Bars3Icon
            class="mx-4 my-auto hidden h-10 w-10 cursor-pointer rounded-md border-gray-500 p-1 text-gray-500 active:text-gray-300 md:block"
            @click="sideMenu.sidebarOpen = true"
          />
        </TabList>
      </TabGroup>
    </div>
    <SideMenu ref="sideMenu" />
  </div>
</template>
