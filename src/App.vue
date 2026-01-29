<script setup lang="ts">
import { type Ref, computed, useTemplateRef, watchPostEffect } from 'vue'
import { useWakeLock } from '@vueuse/core'
import type { Socket } from 'socket.io-client'
import type { World } from '@/types/pf2e-types'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useApi } from '@/composables/api'
import { useServer } from '@/composables/server'
import { useWorld } from '@/composables/world'
import { useCharacterSelect } from '@/composables/characterSelect'
import { usePixelDice } from './composables/pixelDice'
import { useUserId } from './composables/user'

import CharacterSheet from '@/components/CharacterSheet.vue'
const BUILD_MODE: string = import.meta.env.MODE

// connect to server and ping it periodically
const location = new URL(window.location.origin)
const { connectToServer } = useServer()
const { getUserId } = useUserId()
connectToServer(location).then((socket: Ref<Socket | undefined>) => {
  setTimeout(
    () => socket.value?.emit('module.tablemate', { action: 'anybodyHome', userId: getUserId() }),
    100
  )
  if (BUILD_MODE !== 'development') {
    setInterval(() => {
      socket.value?.emit('module.tablemate', { action: 'anybodyHome', userId: getUserId() })
    }, 50000)
  }
})

// request and handle world
const { world, refreshWorld } = useWorld()
const { setupSocketListenersForWorld, setupSocketListenersForApp } = useApi()
setupSocketListenersForApp()
refreshWorld().then((w) => {
  setupSocketListenersForWorld(w as Ref<World>)
})

// keep screen awake (hard to tell if this is working or not)
const { request } = useWakeLock()
document.addEventListener(
  'click',
  function enableNoSleep() {
    document.removeEventListener('click', enableNoSleep, false)
    request('screen')
  },
  false
)

// setup pixel dice handlers
usePixelDice()

// setup characters
const urlId = new URLSearchParams(document.location.search).get('id')
const { characterList, activeCharacterId } = useCharacterSelect(urlId)
const activeIndex = computed(() => characterList.value.indexOf(activeCharacterId.value))
const characters = useTemplateRef('characters')

// debugging tools
if (BUILD_MODE === 'development') {
  watchPostEffect(() => {
    if (!characters.value || !Array.isArray(characters.value)) return
    window.altActors = new Map([])
    window.altCharacters = new Map([])
    characters.value.forEach((panel) => {
      if (panel?.actorOrWorldActor?._id === urlId) {
        window.actor = panel.actorOrWorldActor
        window.character = panel.character
      } else {
        window.altActors.set(panel?.actor?._id, panel?.actorOrWorldActor)
        window.altCharacters.set(panel?.actor?._id, panel?.character)
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
  <TabGroup :selectedIndex="activeIndex" as="div">
    <TabList class="border-divider hidden h-12 gap-0 border bg-white text-xl">
      <Tab
        class="ui-selected:bg-blue-300 relative top-0 p-2 focus:outline-hidden"
        v-for="c in characterList"
        :key="c"
      />
    </TabList>
    <TabPanels>
      <TabPanel
        v-for="c in characterList"
        :key="c"
        :unmount="false"
        :tabIndex="-1"
        v-slot="{ selected }"
        class="h-dvh"
      >
        <Transition
          enter-active-class="duration-1000 ease-out"
          enter-from-class="transform opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="duration-1000 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="transform opacity-0"
        >
          <CharacterSheet v-show="selected" :characterId="c" ref="characters" />
        </Transition>
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
