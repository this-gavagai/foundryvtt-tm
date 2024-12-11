<script setup lang="ts">
// TODO (feature++): add some way to browse compendia, which can be used for adding new items to various contexts
// TODO (dev): remove @jridgewell/gen-mapping, which was locked after an upstream build problem
// TODO (UX): prevent zoom on iPhone double-tap

import { ref, computed, type Ref } from 'vue'
import { watchPostEffect } from 'vue'
import { type Socket } from 'socket.io-client'
import type { Actor, World } from '@/types/pf2e-types'
import type { Character } from '@/composables/character'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useApi } from '@/composables/api'
import { useServer } from '@/composables/server'
import { useWorld } from '@/composables/world'
import { useCharacterSelect } from '@/composables/characterSelect'

import CharacterSheet from '@/components/CharacterSheet.vue'

declare const BUILD_MODE: string
interface CharacterPanel extends Ref {
  actor: Actor
  character: Character
}

const { world, refreshWorld } = useWorld()
const { setupSocketListenersForWorld } = useApi()
refreshWorld().then((w) => {
  setupSocketListenersForWorld(w as Ref<World>)
})

const { connectToServer } = useServer()
const location = new URL(window.location.origin)

// connect to server and ping it periodically
connectToServer(location).then((socket: Ref<Socket | undefined>) => {
  socket.value?.emit('module.tablemate', { action: 'anybodyHome' })
  if (BUILD_MODE !== 'development') {
    setInterval(() => {
      socket.value?.emit('module.tablemate', { action: 'anybodyHome' })
    }, 60000)
  }
})

// const activeIndex = ref<number>(0)
const urlId = new URLSearchParams(document.location.search).get('id')
const { characterList, activeCharacterId } = useCharacterSelect(urlId)
const activeIndex = computed(() => characterList.value.indexOf(activeCharacterId.value))
const characterPanels = ref<CharacterPanel[]>([])

// debugging tools
if (BUILD_MODE === 'development') {
  watchPostEffect(() => {
    window.altActors = new Map([])
    window.altCharacters = new Map([])
    characterPanels.value.forEach((panel: CharacterPanel) => {
      if (panel.actor?._id === urlId) {
        window.actor = panel.actor
        window.character = panel.character
      } else {
        window.altActors.set(panel.actor?._id, panel.actor)
        window.altCharacters.set(panel.actor?._id, panel.character)
      }
    })
  })
  watchPostEffect(() => {
    if (world.value) {
      console.log('TM-RECV world')
      window.world = world.value
    }
  })
}
</script>
<template>
  <TabGroup :selectedIndex="activeIndex" @change="console.log('character changed!')" as="div">
    <TabList class="hidden h-12 gap-0 border border-gray-300 bg-white text-xl">
      <Tab
        class="relative top-0 p-2 focus:outline-none ui-selected:bg-blue-300"
        v-for="c in characterList.length ? characterList : ['']"
        :key="c"
      />
    </TabList>
    <TabPanels>
      <TabPanel
        v-for="(c, index) in characterList.length ? characterList : ['']"
        :key="c"
        :unmount="false"
        :tabIndex="-1"
      >
        <CharacterSheet
          :characterId="c"
          :ref="(el: CharacterPanel) => (characterPanels[index] = el)"
        />
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
