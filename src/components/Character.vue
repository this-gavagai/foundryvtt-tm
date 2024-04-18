<script setup lang="ts">
// TODO: (bug) fix dvh/vh nonsense in iOS
// TODO: (UX) scroll to top on tab change
// TODO: (feature++) add some way to browse compendia, which can be used for adding new items to various contexts
import type { Actor } from '@/types/pf2e-types'
import type { Ref } from 'vue'
import { ref, provide, watch, inject } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'
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

const { requestCharacterDetails, setupSocketListenersForActor } = useApi()
const { width } = useWindowSize()
const sideMenu = ref()

const props = defineProps(['characterId'])

// base data
const actor: Ref<Actor | undefined> = ref()
provide(useKeys().actorKey, actor)
const world = inject(useKeys().worldKey)

// load character from world value if no character details received
watch(world, () => {
  if (world.value?.actors && !actor.value?._id) {
    console.log('using world value')
    actor.value = world.value.actors.find((a: any) => a._id == props.characterId)
  }
})

requestCharacterDetails(props.characterId, actor)
setupSocketListenersForActor(props.characterId, actor)

defineExpose({ actor })
</script>
<template>
  <div class="flex h-screen">
    <div class="hidden md:block border-r overflow-scroll md:w-[320px]">
      <CharacterHeader @pickCharacter="(id: string) => $emit('pickCharacter', id)" />
      <FrontPage />
    </div>
    <div
      class="flex-1 overflow-scroll md:border-l w-full flex flex-col justify-between md:justify-start"
    >
      <TabGroup :defaultIndex="width >= 768 ? 1 : 0">
        <TabPanels tabindex="-1" class="overflow-scroll md:order-last">
          <CharacterHeader
            @pickCharacter="(id: string) => $emit('pickCharacter', id)"
            class="md:hidden"
          />
          <TabPanel tabindex="-1" class="md:hidden">
            <FrontPage />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Skills />
          </TabPanel>
          <TabPanel tabindex="-1">
            <Feats />
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
        <TabList class="border-t h-20 flex justify-around md:border-b">
          <CharacterTab :src="cowled" label="Character" class="md:hidden" />
          <CharacterTab :src="skills" label="Proficiencies" />
          <CharacterTab :src="biceps" label="Feats" />
          <CharacterTab :src="backpack" label="Equipment" />
          <CharacterTab :src="leapfrog" label="Actions" />
          <CharacterTab :src="spellBook" label="Spells" />
          <Bars3Icon
            class="hidden md:block h-10 w-10 my-auto text-gray-500 border-gray-500 rounded-md p-1 mx-4"
            @click="sideMenu.sidebarOpen = true"
          />
        </TabList>
      </TabGroup>
    </div>
    <SideMenu ref="sideMenu" />
  </div>
</template>
