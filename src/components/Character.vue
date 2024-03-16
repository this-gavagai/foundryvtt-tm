<script setup lang="ts">
import { ref, provide, inject } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'

import { useServer } from '@/utils/server'
import { requestCharacterDetails, setupSocketListenersForActor } from '@/utils/api'

import cowled from '@/assets/icons/cowled.svg'
import biceps from '@/assets/icons/biceps.svg'
import backpack from '@/assets/icons/knapsack.svg'
import leapfrog from '@/assets/icons/leapfrog.svg'
import spellBook from '@/assets/icons/spell-book.svg'
import talk from '@/assets/icons/talk.svg'
import skills from '@/assets/icons/skills.svg'

import CharacterTab from '@/components/CharacterTab.vue'
import CharacterHeader from '@/components/CharacterHeader.vue'
import Skills from '@/components/Skills.vue'
import Actions from '@/components/Actions.vue'
import Attributes from '@/components/Attributes.vue'
import Spells from '@/components/Spells.vue'
import Effects from '@/components/Effects.vue'
import Background from '@/components/Background.vue'
import Feats from '@/components/Feats.vue'
import Equipment from '@/components/Equipment.vue'
import Strikes from '@/components/Strikes.vue'
import Armor from '@/components/Armor.vue'
import Initiative from '@/components/Initiative.vue'
import IWR from '@/components/IWR.vue'

const props = defineProps(['characterId'])

// base data
const world: any = inject('world')
const actor = ref<any>({})
provide('actor', actor)

// pretty sure vvvthisvvv is redundant now
// watch world for changes and update actor base
// watch(
//   // TODO: something is happening here where the actor gets wiped out very briefly, throwing errors and requiring unnecessary ?. operators
//   world,
//   () => {
//     if (world.value?.actors) {
//       // const worldActor = world.value.actors.find((a: any) => a._id == props.characterId)
//       // const synthActor = mergeDeep(worldActor, actor.value)
//       // actor.value = synthActor
//     }
//   },
//   { immediate: true }
// )

// await new socket
const { socket } = useServer()
await new Promise(function (resolve: any) {
  ;(function waitForSocket() {
    if (socket.value) return resolve()
    console.log('waiting on socket...')
    setTimeout(waitForSocket, 100)
  })()
})
requestCharacterDetails(props.characterId)
setupSocketListenersForActor(props.characterId, actor)

// debugging conveniences
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altCharacters: any
  }
}
</script>
<template>
  <div class="pb-14">
    <div class="p-0">
      <CharacterHeader />
      <TabGroup>
        <TabPanels class="mb-8" tabindex="-1">
          <TabPanel tabindex="-1">
            <Background />
            <Effects />
            <Initiative />
            <Attributes />
            <Armor />
            <IWR />
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
        <TabList class="fixed bottom-0 grid grid-cols-6 w-full gap-0 border border-gray-300">
          <CharacterTab :src="cowled" label="Character" />
          <CharacterTab :src="skills" label="Skills" />
          <CharacterTab :src="biceps" label="Feats" />
          <CharacterTab :src="backpack" label="Equipment" />
          <CharacterTab :src="leapfrog" label="Actions" />
          <CharacterTab :src="spellBook" label="Spells" />
        </TabList>
      </TabGroup>
    </div>
  </div>
</template>
