<script setup lang="ts">
// TODO: (bug) fix dvh/vh nonsense in iOS
// TODO: abstract actor class to new interface (to simplify system-level changes to data structure)
import type { Actor } from '@/types/pf2e-types'
import { type Ref, onUnmounted, onMounted } from 'vue'
import { ref, provide, watch } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'
import { debounce } from 'lodash-es'
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
import Skills from '@/components/Skills.vue'
import Actions from '@/components/Actions.vue'
import Spells from '@/components/Spells.vue'
import Feats from '@/components/Feats.vue'
import Equipment from '@/components/Equipment.vue'
import Strikes from '@/components/Strikes.vue'
import { useWorld } from '@/composables/world'

const { width } = useWindowSize()
const sideMenu = ref()

const props = defineProps(['characterId'])
const panels = ref()

// TODO: get rid of this. Actor shouldn't be exposed
export interface CharacterRef<T> extends Ref<T> {
  requestCharacterDetails?: Function
}

// base data
const { world } = useWorld()
const actor: CharacterRef<Actor | undefined> = ref()
provide(useKeys().actorKey, actor)
const { character } = useCharacter(actor)
provide(useKeys().characterKey, character)

// load character from world value if no character details received
watch(world, () => {
  // TODO: this seems to load only once, since after first load actor value is not null. need to track gmOnline somehow? or just merge?
  if (world.value?.actors && !actor.value?._id) {
    console.log('using world value')
    actor.value = world.value.actors.find((a: Actor) => a._id == props.characterId)
  }
})

// setup refresh methods
const { sendCharacterRequest, setupSocketListenersForActor } = useApi()
const debouncededCharacterRequest = debounce(sendCharacterRequest, 2000)
const requestCharacterDetails = async () => {
  console.log('refreshing', props.characterId)
  debouncededCharacterRequest(props.characterId, actor)
}

onMounted(() => {
  console.log('TABLEMATE: initiating character', props.characterId)
  setupSocketListenersForActor(props.characterId, actor, requestCharacterDetails)
  sendCharacterRequest(props.characterId, actor)
  // TODO: attaching this to the actor is lazy. It should be defined differently
  // actor.requestCharacterDetails = requestCharacterDetails
})
onUnmounted(() => {
  console.log('unmounted actor: ', actor?.value?._id)
})
// defineExpose({ actor })
</script>
<template>
  <div class="flex h-screen">
    <div class="hidden border-r md:block md:h-screen md:w-[320px] md:overflow-auto">
      <CharacterHeader @pickCharacter="(id: string) => $emit('pickCharacter', id)" />
      <FrontPage />
    </div>
    <div class="flex w-0 flex-1 flex-col justify-between md:h-screen md:justify-start md:border-l">
      <TabGroup :defaultIndex="width >= 768 ? 1 : 0" @change="panels.$el.scrollTop = 0">
        <TabPanels tabindex="-1" class="overflow-auto md:order-last" ref="panels">
          <CharacterHeader
            @pickCharacter="(id: string) => $emit('pickCharacter', id)"
            class="md:hidden"
          />
          <TabPanel tabindex="-1" class="md:hidden">
            <FrontPage />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Feats />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Skills />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Equipment />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Strikes />
            <Actions />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Spells />
          </TabPanel>
        </TabPanels>
        <TabList class="flex h-20 justify-around border-t md:border-b">
          <CharacterTab :src="cowled" label="Character" class="md:hidden" />
          <CharacterTab :src="biceps" label="Feats" />
          <CharacterTab :src="skills" label="Proficiencies" />
          <CharacterTab :src="backpack" label="Equipment" />
          <CharacterTab :src="leapfrog" label="Actions" />
          <CharacterTab :src="spellBook" label="Spells" />
          <Bars3Icon
            class="mx-4 my-auto hidden h-10 w-10 rounded-md border-gray-500 p-1 text-gray-500 md:block"
            @click="sideMenu.sidebarOpen = true"
          />
        </TabList>
      </TabGroup>
    </div>
    <SideMenu ref="sideMenu" />
  </div>
</template>
