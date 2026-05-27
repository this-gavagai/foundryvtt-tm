<script setup lang="ts">
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Ref, ComputedRef } from 'vue'
import { ref, provide, computed, onMounted } from 'vue'
import { TabGroup, TabList, TabPanels } from '@headlessui/vue'

import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
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
import ActionsList from '@/components/ActionsList.vue'
import SpellList from '@/components/SpellList.vue'
import FeatsList from '@/components/FeatsList.vue'
import EquipmentList from '@/components/EquipmentList.vue'
import StrikeList from '@/components/StrikeList.vue'

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
const { world } = storeToRefs(useWorldStore())
const { userId } = storeToRefs(useUserStore())
const actor: Ref<TablemateCharacter | undefined> = ref()
const actorOrWorldActor = computed<TablemateCharacter | undefined>(
  () =>
    actor.value ??
    (world.value?.actors?.find<CharacterPF2e<null>>((a) => a._id == props.characterId) as
      | TablemateCharacter
      | undefined)
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
provide(characterKey, character)

// keep the local actor ref synced with Foundry via socket events
useActorSync(props.characterId, actor)

// set initial tab based on viewport
onMounted(() => {
  currentTab.value = width.value >= 768 ? 1 : 0
})

defineExpose({ actor, character, actorOrWorldActor })
</script>
<template>
  <div class="flex h-dvh select-none" v-if="userHasActorPermission">
    <!-- show this column only if on a tablet or laptop -->
    <div data-part="sheet-left" class="border-divider hidden border-r md:block md:h-dvh md:w-80 md:overflow-auto">
      <CharacterHeader class="sticky top-0 z-10 h-32" />
      <FrontPage />
    </div>
    <!-- show this column on all devices -->
    <div
      data-part="sheet-right"
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
            <div class="px-6 lg:columns-2">
              <StrikeList />
              <ActionsList />
            </div>
          </CharacterPanel>
          <CharacterPanel :goLeft="goLeft">
            <SpellList />
          </CharacterPanel>
        </TabPanels>
        <TabList data-part="tab-bar" class="border-divider bottom-0 flex h-24 justify-around border-t border-b">
          <CharacterTab :src="cowled" :label="$t('tabs.character')" class="w-1/6 md:hidden" />
          <CharacterTab :src="biceps" :label="$t('tabs.feats')" class="w-1/6" />
          <CharacterTab :src="skills" :label="$t('tabs.proficiencies')" class="w-1/6" />
          <CharacterTab :src="backpack" :label="$t('tabs.equipment')" class="w-1/6" />
          <CharacterTab :src="leapfrog" :label="$t('tabs.actions')" class="w-1/6" />
          <CharacterTab :src="spellBook" :label="$t('tabs.spells')" class="w-1/6" />
          <Bars3Icon
            class="mx-4 my-auto hidden h-10 w-10 cursor-pointer rounded-md border-gray-900 p-1 text-gray-600 active:text-gray-300 md:block"
            @click="sideMenu.sidebarOpen = true"
          />
        </TabList>
      </TabGroup>
    </div>
    <SideMenu ref="sideMenu" />
  </div>
  <div v-else>{{ $t('app.userDoesNotOwnCharacter') }}</div>
</template>
