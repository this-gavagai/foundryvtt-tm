<script setup lang="ts">
// TODO: (bug) fix dvh/vh nonsense in iOS
import type { Actor } from '@/types/pf2e-types'
import type { Ref } from 'vue'
import { ref, provide, watch, inject } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'
import { useThrottleFn } from '@vueuse/core'
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

const { sendCharacterRequest, setupSocketListenersForActor } = useApi()
const { width } = useWindowSize()
const sideMenu = ref()

const props = defineProps(['characterId'])
const panels = ref()

export interface CharacterRef<T> extends Ref<T> {
  requestCharacterDetails?: Function
}

// base data
const world = inject(useKeys().worldKey)!
const actor: CharacterRef<Actor | undefined> = ref()
provide(useKeys().actorKey, actor)

// load character from world value if no character details received
watch(world, () => {
  if (world.value?.actors && !actor.value?._id) {
    console.log('using world value')
    actor.value = world.value.actors.find((a: Actor) => a._id == props.characterId)
  }
})

// requestCharacterDetails(props.characterId, actor)
const throttledCharacterRequest = useThrottleFn(sendCharacterRequest, 1000, true, false)
actor.requestCharacterDetails = async () => throttledCharacterRequest(props.characterId, actor)
sendCharacterRequest(props.characterId, actor)
setupSocketListenersForActor(props.characterId, actor)

defineExpose({ actor })
</script>
<template>
  <div class="flex h-screen">
    <div class="hidden overflow-scroll border-r md:block md:w-[320px]">
      <CharacterHeader @pickCharacter="(id: string) => $emit('pickCharacter', id)" />
      <FrontPage />
    </div>
    <div
      class="flex w-full flex-1 flex-col justify-between overflow-scroll md:justify-start md:border-l"
    >
      <TabGroup :defaultIndex="width >= 768 ? 1 : 0" @change="panels.$el.scrollTop = 0">
        <TabPanels tabindex="-1" class="overflow-scroll md:order-last" ref="panels">
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
        <TabList class="flex h-20 justify-around border-t md:border-b">
          <CharacterTab :src="cowled" label="Character" class="md:hidden" />
          <CharacterTab :src="skills" label="Proficiencies" />
          <CharacterTab :src="biceps" label="Feats" />
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
