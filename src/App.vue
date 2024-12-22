<script setup lang="ts">
import { ref, computed, type Ref } from 'vue'
import { watchPostEffect } from 'vue'
import { useWakeLock } from '@vueuse/core'
import { type Socket } from 'socket.io-client'
import type { Actor, World } from '@/types/pf2e-types'
import type { Character } from '@/composables/character'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useApi } from '@/composables/api'
import { useServer } from '@/composables/server'
import { useWorld } from '@/composables/world'
import { useCharacterSelect } from '@/composables/characterSelect'

import { usePixelDice } from './composables/pixelDice'

import CharacterSheet from '@/components/CharacterSheet.vue'

declare const BUILD_MODE: string
interface CharacterPanel extends Ref {
  actor: Actor
  character: Character
  actorOrWorldActor: Actor
}

const { pixelReconnect } = usePixelDice()
pixelReconnect()

const { world, refreshWorld } = useWorld()
const { setupSocketListenersForWorld, setupSocketListenersForApp } = useApi()
setupSocketListenersForApp()
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

const { request } = useWakeLock()
document.addEventListener(
  'click',
  function enableNoSleep() {
    document.removeEventListener('click', enableNoSleep, false)
    request('screen')
  },
  false
)

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
      if (panel.actorOrWorldActor?._id === urlId) {
        window.actor = panel.actorOrWorldActor
        window.character = panel.character
      } else {
        window.altActors.set(panel.actor?._id, panel.actorOrWorldActor)
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
  <TabGroup :selectedIndex="activeIndex" as="div">
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
          <CharacterSheet
            v-show="selected"
            :characterId="c"
            :ref="(el: CharacterPanel) => (characterPanels[index] = el)"
          />
        </Transition>
      </TabPanel>
    </TabPanels>
  </TabGroup>
</template>
