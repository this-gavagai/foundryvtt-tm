<script setup lang="ts">
import { computed, ref, watch, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useServerStore } from '@/stores/server'
import { useFoundryWorldStatusStore } from '@/stores/foundryWorldStatus'
import { usePixelDice } from '@/stores/pixelDice'
import { hasActorSnapshot } from '@/utils/actorCache'

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
import { useScrollBoundaryLock } from '@/composables/useScrollBoundaryLock'

initTheme()
useScrollBoundaryLock()

const { needsLogin } = storeToRefs(useServerStore())
const { worldAuthenticated, worldLoaded } = storeToRefs(useFoundryWorldStatusStore())

const { reconnecting } = useSession()
const { urlId, characterList, activeCharacterId } = useCharacterRouting()
useConnectionRecovery()
useKeepScreenAwake()
usePixelDice()

// True once we have a persisted snapshot for the active character, so the
// initial handshake can paint that cached sheet instead of a full-screen
// spinner. Re-checked whenever the active character changes.
const canShowCached = ref(false)
watch(
  activeCharacterId,
  (id) => {
    if (!id) {
      canShowCached.value = false
      return
    }
    void hasActorSnapshot(id).then((has) => {
      // Guard against a race where the active character changed while the
      // async check was in flight.
      if (activeCharacterId.value === id) canShowCached.value = has
    })
  },
  { immediate: true }
)

const fullyReady = computed(
  () => worldLoaded.value === true && !needsLogin.value && worldAuthenticated.value === true
)

// Paint the cached sheet during the connection handshake rather than a
// spinner, as long as the world isn't known-down. `reconnecting` is treated
// like "auth still pending" — it's the signal that a needsLogin is provisional
// and a re-handshake is in flight, so we'd rather show stale data than flash
// the login page. Falls through to LoginPage only once login is genuinely
// required (needsLogin true and no reconnect in flight).
const showCachedSheet = computed(
  () =>
    !fullyReady.value &&
    canShowCached.value &&
    worldLoaded.value !== false &&
    (!needsLogin.value || reconnecting.value)
)

const isLoading = computed(
  () =>
    !fullyReady.value &&
    !showCachedSheet.value &&
    (worldLoaded.value === undefined ||
      reconnecting.value ||
      (worldLoaded.value && !needsLogin.value && worldAuthenticated.value !== true))
)

const characters = useTemplateRef('characters')
useDevGlobals(characters, urlId)
</script>
<template>
  <div class="fixed inset-0 overflow-hidden">
    <div v-if="isLoading" class="flex h-dvh items-center justify-center">
      <Spinner class="h-12 w-12" />
    </div>
    <div
      v-else-if="worldLoaded === false"
      data-component="NoWorldMessage"
      class="flex h-dvh items-center justify-center p-8 text-center text-lg"
    >
      {{ $t('app.noWorld') }}
    </div>
    <LoginPage v-else-if="needsLogin && !showCachedSheet" />
    <TabGroup
      v-else
      :selectedIndex="characterList.indexOf(activeCharacterId)"
      as="div"
      class="h-full overflow-hidden"
    >
      <!-- tabs control routing only; list is visually hidden -->
      <TabList class="border-divider hidden h-12 gap-0 border bg-white text-xl">
        <Tab
          class="ui-selected:bg-blue-300 relative top-0 p-2 focus:outline-hidden"
          v-for="c in characterList"
          :key="c"
        />
      </TabList>
      <TabPanels class="h-full overflow-hidden">
        <TabPanel
          v-for="c in characterList"
          :key="c"
          :unmount="false"
          :tabIndex="-1"
          v-slot="{ selected }"
          class="h-full overflow-hidden"
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
