<script setup lang="ts">
import { type Ref, ref, useTemplateRef, watch, watchPostEffect } from 'vue'
import { useWakeLock } from '@vueuse/core'
import type { Socket } from 'socket.io-client'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import {
  setupSocketListenersForApp,
  setupSocketListenersForWorld
} from '@/api/socketSetup'
import { TM } from '@/api/protocol'
import { useServerStore } from '@/stores/server'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import { usePixelDiceStore } from '@/stores/pixelDice'
import { useUserStore } from '@/stores/user'

import CharacterSheet from '@/components/CharacterSheet.vue'
import LoginPage from '@/components/LoginPage.vue'
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { logger } from './utils/utilities'
import { initTheme } from '@/composables/useTheme'

initTheme()

const BUILD_MODE: string = import.meta.env.MODE

// connect to server and ping it periodically
const location = new URL(window.location.origin)
const serverStore = useServerStore()
const { needsLogin, socket } = storeToRefs(serverStore)
const { connectToServer } = serverStore
const userStore = useUserStore()
const { userId } = storeToRefs(userStore)
const { getUserId } = userStore
connectToServer(location).then((socket: Ref<Socket | undefined>) => {
  setTimeout(
    () => socket.value?.emit(TM.CHANNEL, { action: TM.ANYBODY_HOME, userId: getUserId() }),
    100
  )
  if (BUILD_MODE !== 'development') {
    setInterval(() => {
      socket.value?.emit(TM.CHANNEL, { action: TM.ANYBODY_HOME, userId: getUserId() })
    }, 50000)
  }
})

// request and handle world
const worldStore = useWorldStore()
const { world, worldActive, worldRunning } = storeToRefs(worldStore)
const { refreshWorld } = worldStore
// Re-register socket listeners whenever a new socket is created (e.g. after
// connectToServer replaces the socket on auth failure or re-login).
// setupSocketListenersForApp/World are idempotent: they remove stale handlers
// before re-adding, so calling them multiple times is safe.
let worldListenersReady = false
watch(socket, (newSocket) => {
  if (!newSocket) return
  setupSocketListenersForApp()
  if (worldListenersReady) refreshWorld().then((w) => setupSocketListenersForWorld(w))
})

// When the world starts while the socket is unauthenticated, Foundry won't
// re-send the session event on the existing socket — reconnecting causes a
// fresh handshake so Foundry can authenticate the browser's session cookie.
// reconnecting stays true while connectToServer is in-flight so the spinner
// is shown instead of LoginPage, preventing loadUsers from running against
// the old pre-world socket before the new one is ready.
const reconnecting = ref(false)
watch(worldRunning, async (isRunning) => {
  if (isRunning && needsLogin.value) {
    reconnecting.value = true
    await connectToServer(location)
    reconnecting.value = false
  }
})

// Keep watching userId so refreshWorld() fires whenever a session is
// established or re-established (e.g. world reloads after being inactive).
watch(
  userId,
  (newId) => {
    if (!newId) return
    if (!worldListenersReady) {
      worldListenersReady = true
      refreshWorld().then((w) => setupSocketListenersForWorld(w))
    } else {
      refreshWorld()
    }
  },
  { immediate: true }
)

// setup characters
const urlId =
  new URLSearchParams(document.location.search).get('id') ??
  localStorage.getItem('lastCharacterId')
const characterSelectStore = useCharacterSelectStore()
characterSelectStore.initialize(urlId)
const { characterList, activeCharacterId } = storeToRefs(characterSelectStore)
// After a successful login the socket reconnects and needsLogin drops to false.
// Re-request the world immediately rather than waiting for the next heartbeat.
watch(needsLogin, (val) => { if (!val) refreshWorld() })

watch(activeCharacterId, (newValue) => {
  if (!newValue) return
  localStorage.setItem('lastCharacterId', newValue)
  const url = `${window.location.origin}/modules/tablemate/index.html?id=${newValue}`
  history.replaceState({}, '', url)
})
const characters = useTemplateRef('characters')

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
usePixelDiceStore()

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
      logger.info('TM-RECV world')
      window.world = world.value
    }
  })
}
</script>
<template>
  <div v-if="worldRunning === undefined || reconnecting || (worldRunning && !needsLogin && worldActive !== true)" class="flex h-dvh items-center justify-center">
    <Spinner class="h-12 w-12" />
  </div>
  <div v-else-if="!worldRunning" data-component="NoWorldMessage" class="flex h-dvh items-center justify-center p-8 text-center text-lg">
    {{ $t('app.noWorld') }}
  </div>
  <LoginPage v-else-if="needsLogin" />
  <TabGroup v-else :selectedIndex="characterList.indexOf(activeCharacterId)" as="div">
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
