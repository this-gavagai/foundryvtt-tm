<script setup lang="ts">
// TODO: add languages
// TODO: add speeds
import type { Actor } from '@/types/pf2e-types'
import type { Ref } from 'vue'
import { ref, shallowRef, markRaw, reactive, provide, watch, inject } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import cowled from '@/assets/icons/cowled.svg'
import biceps from '@/assets/icons/biceps.svg'
import backpack from '@/assets/icons/knapsack.svg'
import leapfrog from '@/assets/icons/leapfrog.svg'
import spellBook from '@/assets/icons/spell-book.svg'
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

const { requestCharacterDetails, setupSocketListenersForActor } = useApi()

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

requestCharacterDetails(props.characterId)
setupSocketListenersForActor(props.characterId, actor)

defineExpose({ actor })
</script>
<template>
  <div class="pb-14">
    <div class="p-0">
      <CharacterHeader @pickCharacter="(id: string) => $emit('pickCharacter', id)" />
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
@/composables@/types/pf2e-types
