<script setup lang="ts">
import { ref, provide, computed, nextTick, reactive } from 'vue'
import { useServer } from './utils/server'
import Character from '@/components/Character.vue'
import { useWakeLock } from '@vueuse/core'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

const wakeLock = reactive(useWakeLock())
wakeLock.request('screen')
console.log('wakelock', wakeLock.isActive, wakeLock.isSupported, wakeLock)

const urlParams = new URLSearchParams(window.location.search)
const urlId = urlParams.get('id')

const { socket, connectToServer } = useServer()
const selectedTab = ref(0)
// const charRefs = ref<any[]>([])
const world = ref<any>({})
provide('world', world)

function changeChar(id: string): void {
  selectedTab.value = characterIds.value.indexOf(id)
}
provide('changeChar', changeChar)

const characterIds = computed(() => {
  let characters = []
  if (urlId) characters.push(urlId)
  world.value?.actors
    ?.filter((a: any) => a.ownership[world.value.userId] === 3)
    ?.filter((a: any) => a._id !== urlId)
    .forEach((a: any) => characters.push(a._id))
  return characters
})

connectToServer(window.location.origin).then(() => {
  socket.value.emit('world', (r: any) => {
    console.log('TM-RECV world', r)
    world.value = r
    window.world = world.value
    nextTick()
  })
})

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
  <Suspense>
    <template #default>
      <TabGroup :selectedIndex="selectedTab">
        <TabList class="h-12 bg-white gap-0 border border-gray-300 text-xl hidden">
          <Tab
            class="p-2 ui-selected:bg-blue-300 focus:outline-none relative top-0"
            v-for="c in characterIds"
            :key="c"
          />
        </TabList>
        <TabPanels>
          <TabPanel :unmount="false" v-for="characterId in characterIds" tabindex="-1">
            <Character :characterId="characterId" />
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </template>
    <template #fallback>
      <div>Loading...</div>
    </template>
  </Suspense>
</template>
<style scoped></style>
