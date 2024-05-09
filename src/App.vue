<script setup lang="ts">
// TODO: (feature++) add some way to browse compendia, which can be used for adding new items to various contexts

import { ref, type Ref, type VNodeRef, provide, watchPostEffect } from 'vue'
import { useServer } from './composables/server'
import { useCharacterSelect } from './composables/characterSelect'
import { useApi } from './composables/api'
import { useKeys } from './composables/injectKeys'
import type { Actor, World } from '@/types/pf2e-types'
import { Socket } from 'socket.io-client'

import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'
import Character from '@/components/Character.vue'

declare const BUILD_MODE: string

interface CharacterPanel extends Ref {
  actor: Actor
}

const urlId = new URLSearchParams(document.location.search).get('id')
const world: Ref<World | undefined> = ref()
provide(useKeys().worldKey, world)

const { connectToServer } = useServer()
const { setupSocketListenersForWorld } = useApi()
const location = new URL(window.location.origin)
if (!world.value) {
  connectToServer(location).then((socket) => {
    socket.value?.emit('world', (r: World) => {
      world.value = r
      setupSocketListenersForWorld(world as Ref<World>).then(() => {
        socket.value?.emit('module.tablemate', { action: 'anybodyHome' })
      })
    })
  })
}

const activeIndex = ref<number>(0)
const { characterList } = useCharacterSelect(urlId, world)
// const characterPanels = ref<InstanceType<typeof Character>[]>([])
const characterPanels = ref<CharacterPanel[]>([])

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
        <Character
          :characterId="c"
          :ref="(el: CharacterPanel) => (characterPanels[index] = el)"
          @pickCharacter="(id: string) => (activeIndex = characterList.indexOf(id))"
        />
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
