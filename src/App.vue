<script setup lang="ts">
import { ref, provide, computed, reactive, watch } from 'vue'
import { useWakeLock } from '@vueuse/core'
import { useServer } from './utils/server'
import { useWorld } from './composables/world'

import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'
import Character from '@/components/Character.vue'

const urlId = new URLSearchParams(window.location.search).get('id')

// TODO: figure out why this isn't working correctly
const wakeLock = reactive(useWakeLock())
wakeLock.request('screen')

const { socket, connectToServer } = useServer()
const { world } = useWorld()
// provide('world', world)

const selectedTab = ref(0)
const characterPanels = ref<any[]>([])
const characterIds = computed(() => {
  let characters = []
  if (urlId) characters.push(urlId)
  world.value?.actors
    ?.filter((a: any) => a.ownership[world.value.userId] === 3)
    ?.filter((a: any) => a._id !== urlId)
    .forEach((a: any) => characters.push(a._id))
  return characters
})
watch(
  // set window variables. This watch can be deleted on production
  characterIds,
  (newValue, oldValue) => {
    window.altCharacters = new Map([])
    console.log('chars', newValue)
    setTimeout(() => {
      characterPanels.value.forEach((panel: any) => {
        const id = panel.actor?._id
        if (id && id === newValue[0]) window.actor = panel.actor
        else window.altCharacters.set(id, panel.actor)
      })
    }, 100)
  },
  { immediate: true }
)

function changeChar(id: string): void {
  selectedTab.value = characterIds.value.indexOf(id)
}
provide('changeChar', changeChar)

// TODO: is gathering the world value really useful anymore? Better to use it just as a fallback?
// connectToServer(window.location.origin).then(() => {
//   socket.value.emit('world', (r: any) => {
//     console.log('TM-RECV world', r)
//     window.world = world.value = r
//   })
// })
</script>
<template>
  <TabGroup :selectedIndex="selectedTab" @change="console.log('character changed!')">
    <TabList class="h-12 bg-white gap-0 border border-gray-300 text-xl hidden">
      <Tab
        class="p-2 ui-selected:bg-blue-300 focus:outline-none relative top-0"
        v-for="c in characterIds"
        :key="c"
      />
    </TabList>
    <TabPanels>
      <TabPanel v-for="(c, index) in characterIds" :key="c" :unmount="false" tabindex="-1">
        <Character :characterId="c" :ref="(el: any) => (characterPanels[index] = el)" />
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
