<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useServerStore } from '@/stores/server'
import { useWorldStore } from '@/stores/world'
import { usePixelDiceStore } from '@/stores/pixelDice'

import CharacterSheet from '@/components/CharacterSheet.vue'
import LoginPage from '@/components/LoginPage.vue'
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import UpdatePrompt from '@/components/UpdatePrompt.vue'
import ReconnectingBanner from '@/components/ReconnectingBanner.vue'

import { initTheme } from '@/composables/useTheme'
import { useSession } from '@/composables/useSession'
import { useCharacterRouting } from '@/composables/useCharacterRouting'
import { useConnectionRecovery } from '@/composables/useConnectionRecovery'
import { useKeepScreenAwake } from '@/composables/useKeepScreenAwake'
import { useDevGlobals } from '@/composables/useDevGlobals'

initTheme()

// Reactive state the template gates on; the lifecycle behind it lives in the
// composables below.
const { needsLogin } = storeToRefs(useServerStore())
const { worldActive, worldRunning } = storeToRefs(useWorldStore())

// Cross-cutting lifecycle: server/world session, character routing, mobile
// connection recovery, screen wake-lock, and pixel-dice handlers.
const { reconnecting } = useSession()
const { urlId, characterList, activeCharacterId } = useCharacterRouting()
useConnectionRecovery()
useKeepScreenAwake()
usePixelDiceStore()

const characters = useTemplateRef('characters')
useDevGlobals(characters, urlId)
</script>
<template>
  <div>
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
    <UpdatePrompt />
    <ReconnectingBanner />
  </div>
</template>
