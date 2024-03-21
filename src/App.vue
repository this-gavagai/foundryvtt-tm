<script setup lang="ts">
import { ref, provide, reactive, watch, watchPostEffect } from 'vue'
import { useWakeLock } from '@vueuse/core'
import { useServer } from './composables/server'
import { useCharacterSelect } from './composables/characterSelect'

import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'
import Character from '@/components/Character.vue'

// TODO: figure out why this isn't working correctly
// const wakeLock = reactive(useWakeLock())
const wakeLock = useWakeLock()
wakeLock.request('screen')

const urlId = new URLSearchParams(window.location.search).get('id')
const world: any = ref()
provide('world', world)

const { connectToServer } = useServer()
connectToServer(window.location.origin).then((socket: any) => {
  socket.value.emit('world', (r: any) => {
    console.log('TM-RECV world', r)
    window.world = world.value = r
  })
  socket.value.emit('module.tablemate', { action: 'anybodyHome' })
})

const activeIndex = ref<number>(0)
const { characterList } = useCharacterSelect(urlId, world)
const characterPanels = ref<any[]>([])
// set window variables. This watchEffect can be removed on production
watchPostEffect(() => {
  window.altCharacters = new Map([])
  characterPanels.value.forEach((panel: any) => {
    if (panel.actor?._id === urlId) window.actor = panel.actor
    else window.altCharacters.set(panel.actor?._id, panel.actor)
  })
})
</script>
<template>
  <TabGroup :selectedIndex="activeIndex" @change="console.log('character changed!')">
    <TabList class="h-12 bg-white gap-0 border border-gray-300 text-xl hidden">
      <Tab
        class="p-2 ui-selected:bg-blue-300 focus:outline-none relative top-0"
        v-for="c in characterList"
        :key="c"
      />
    </TabList>
    <TabPanels>
      <TabPanel v-for="(c, index) in characterList" :key="c" :unmount="false" tabindex="-1">
        <Character
          :characterId="c"
          :ref="(el: any) => (characterPanels[index] = el)"
          @pickCharacter="(id: string) => (activeIndex = characterList.indexOf(id))"
        />
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
