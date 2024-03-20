<script setup lang="ts">
import { ref, provide, computed, reactive, watch } from 'vue'
import { useWakeLock } from '@vueuse/core'
import { useServer } from './composables/server'
import { useCharacterPicker } from './composables/characterPicker'

import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'
import Character from '@/components/Character.vue'

const urlId = new URLSearchParams(window.location.search).get('id')
const { connectToServer } = useServer()

// TODO: figure out why this isn't working correctly
const wakeLock = reactive(useWakeLock())
wakeLock.request('screen')

const world = ref()
connectToServer(window.location.origin).then((socket: any) => {
  socket.value.emit('world', (r: any) => {
    console.log('TM-RECV world', r)
    window.world = world.value = r
  })
  socket.value.emit('module.tablemate', { action: 'anybodyHome' })
})
provide('world', world)

const selectedTab = ref(0)
const characterPanels = ref<any[]>([])
const characterIds = computed(() => {
  let characters = new Set<string>()
  if (urlId) characters.add(urlId)
  world.value?.actors
    ?.filter((a: any) => a.ownership[world.value.userId] === 3)
    .forEach((a: any) => characters.add(a._id))
  return [...characters]
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
