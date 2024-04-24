<script setup lang="ts">
import { ref, provide, watchPostEffect } from 'vue'
import { useWakeLock } from '@vueuse/core'
import { useServer } from './composables/server'
import { useCharacterSelect } from './composables/characterSelect'
import { useApi } from './composables/api'
import { useKeys } from './composables/injectKeys'

import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'
import Character from '@/components/Character.vue'

declare const BUILD_MODE: string

// TODO: (bug) figure out why this isn't working correctly
// const wakeLock = reactive(useWakeLock())
// wakeLock.request('screen')

const urlId = new URLSearchParams(document.location.search).get('id')
const world: any = ref()
provide(useKeys().worldKey, world)

const { connectToServer } = useServer()
const { setupSocketListenersForWorld } = useApi()
connectToServer(window.location.origin).then((socket: any) => {
  socket.value.emit('world', (r: any) => (world.value = r))
  setupSocketListenersForWorld(world).then(() => {
    socket.value.emit('module.tablemate', { action: 'anybodyHome' })
  })
})

const activeIndex = ref<number>(0)
const { characterList } = useCharacterSelect(urlId, world)
const characterPanels = ref<any[]>([])

if (BUILD_MODE === 'development') {
  watchPostEffect(() => {
    const globalLocation = typeof parent.game === 'undefined' ? window : parent
    globalLocation.altCharacters = new Map([])
    characterPanels.value.forEach((panel: any) => {
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
          :ref="(el: any) => (characterPanels[index] = el)"
          @pickCharacter="(id: string) => (activeIndex = characterList.indexOf(id))"
        />
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
