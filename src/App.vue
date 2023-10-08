<script setup lang="ts">
import { ref, onMounted, nextTick, provide, computed, watch } from 'vue'
import { useServer } from './utils/server'
import Character from '@/components/Character.vue'
import { useWakeLock } from '@vueuse/core'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altCharacters: any
  }
}

const { socket, connectToServer } = useServer()
const characterId = ref<String | null>()
const selectedTab = ref(0)
const world = ref<any>({})
const mainCharacter = ref<any>()
const altCharacters = ref<any[]>([])
provide('world', world)

function changeChar(id: string): void {
  const chars = world.value.actors
    ?.filter((a: any) => a.ownership[world.value.userId] === 3)
    ?.filter((a: any) => a._id !== characterId.value)
    .map((a: any) => a._id)
  selectedTab.value = [characterId.value, ...chars].indexOf(id)
}
provide('changeChar', changeChar)

const urlParams = new URLSearchParams(window.location.search)
const urlId = urlParams.get('id')
characterId.value = urlId

connectToServer(window.location.origin).then(() => {
  socket.value.emit('world', (r: any) => {
    console.log('world received', r)
    world.value = r
    window.world = world.value
    console.log(characterIds.value)
  })
})

const characterIds = computed(() => {
  let characters = []
  if (urlId) characters.push(urlId)
  world.value?.actors
    ?.filter((a: any) => a.ownership[world.value.userId] === 3)
    ?.filter((a: any) => a._id !== urlId)
    .forEach((a: any) => characters.push(a._id))
  return characters
})

const wakeLock = useWakeLock()
wakeLock.request('screen')
</script>
<template>
  <Suspense>
    <template #default>
      <TabGroup :selectedIndex="selectedTab">
        <TabList class="h-12 bg-white gap-0 border border-gray-300 text-xl hidden">
          <Tab class="p-2 ui-selected:bg-blue-300 focus:outline-none relative top-0">Main</Tab>
          <Tab
            class="p-2 ui-selected:bg-blue-300 focus:outline-none relative top-0"
            v-for="character in world.actors
              ?.filter((a: any) => a.ownership[world.userId] === 3)
              ?.filter((a: any) => a._id !== characterId)"
          >
            {{ character.name }}
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel :unmount="false">
            <Character :characterId="characterId" v-if="characterId" />
          </TabPanel>
          <TabPanel
            :unmount="false"
            v-for="character in world.actors
              ?.filter((a: any) => a.ownership[world.userId] === 3)
              ?.filter((a: any) => a._id !== characterId)"
          >
            <Character :characterId="character._id" />
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
