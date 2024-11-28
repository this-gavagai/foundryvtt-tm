<script setup lang="ts">
// TODO: (feature++) add some way to browse compendia, which can be used for adding new items to various contexts
// TODO: rather than this @pickCharacter event, use a composable with app-level variable?

import { ref, type Ref } from 'vue'
import { watchPostEffect } from 'vue'
import { type Socket } from 'socket.io-client'
import type { Actor, World } from '@/types/pf2e-types'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useApi } from '@/composables/api'
import { useServer } from '@/composables/server'
import { useWorld } from '@/composables/world'
import { useCharacterSelect } from '@/composables/characterSelect'

import CharacterSheet from '@/components/CharacterSheet.vue'

interface CharacterPanel extends Ref {
  actor: Actor
}

const urlId = new URLSearchParams(document.location.search).get('id')
const { world, refreshWorld } = useWorld()

const { setupSocketListenersForWorld } = useApi()
refreshWorld().then(() => setupSocketListenersForWorld(world as Ref<World>))

const { connectToServer } = useServer()
const location = new URL(window.location.origin)

// connect to server and ping it periodically
connectToServer(location).then((socket: Ref<Socket | undefined>) => {
  socket.value?.emit('module.tablemate', { action: 'anybodyHome' })
  setInterval(() => {
    socket.value?.emit('module.tablemate', { action: 'anybodyHome' })
  }, 60000)
})

const activeIndex = ref<number>(0)
const { characterList } = useCharacterSelect(urlId)
const characterPanels = ref<CharacterPanel[]>([])

// debugging tools
declare const BUILD_MODE: string
if (BUILD_MODE === 'development') {
  watchPostEffect(() => {
    const globalLocation = typeof parent.game === 'undefined' ? window : parent
    globalLocation.altCharacters = new Map([])
    characterPanels.value.forEach((panel: CharacterPanel) => {
      if (panel.actor?._id === urlId) {
        globalLocation.actor = panel.actor
      } else {
        globalLocation.altCharacters.set(panel.actor?._id, panel.actor)
      }
    })
  })
  watchPostEffect(() => {
    const globalLocation = typeof parent.game === 'undefined' ? window : parent
    if (world.value) {
      console.log('TM-RECV world')
      globalLocation.world = world.value
    }
  })
}
</script>
<template>
  <TabGroup :selectedIndex="activeIndex" @change="console.log('character changed!')" as="div">
    <TabList class="hidden h-12 gap-0 border border-gray-300 bg-white text-xl">
      <Tab
        class="relative top-0 p-2 focus:outline-none ui-selected:bg-blue-300"
        v-for="c in characterList"
        :key="c"
      />
    </TabList>
    <TabPanels>
      <TabPanel v-for="(c, index) in characterList" :key="c" :unmount="false" :tabIndex="-1">
        <CharacterSheet
          :characterId="c"
          :ref="(el: CharacterPanel) => (characterPanels[index] = el)"
          @pickCharacter="(id: string) => (activeIndex = characterList.indexOf(id))"
        />
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
