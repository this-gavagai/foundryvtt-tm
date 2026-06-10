<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@/stores/server'
import { useSyncStatusStore } from '@/stores/syncStatus'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import Spinner from '@/components/widgets/SpinnerWidget.vue'

// One banner for two transient "data isn't live yet" states. They never overlap
// in practice, so a single pill with a state-appropriate label covers both:
//   • Reconnecting — the socket transport dropped after a prior successful
//     connection. Suppressed during the very first connect of a session (the
//     app shell shows a spinner then, so a banner would be redundant noise).
//   • Syncing — the active character is showing a cached snapshot from a prior
//     session while its first live payload is still in flight. The socket is
//     typically healthy here; we're just mid-fetch.
const { isConnected } = storeToRefs(useServerStore())
const { activeCharacterId } = storeToRefs(useCharacterSelectStore())
const syncStatus = useSyncStatusStore()

const hasEverConnected = ref(false)
watch(
  isConnected,
  (val) => {
    if (val) hasEverConnected.value = true
  },
  { immediate: true }
)

const reconnecting = computed(() => hasEverConnected.value && !isConnected.value)
const syncing = computed(() => syncStatus.staleActors.has(activeCharacterId.value))
const visible = computed(() => reconnecting.value || syncing.value)
</script>
<template>
  <Transition
    enter-active-class="duration-150 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="visible"
      data-component="ReconnectingBanner"
      class="pointer-events-none fixed bottom-28 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gray-700 bg-gray-900/95 px-4 py-2 text-sm text-white shadow-lg"
      role="status"
      aria-live="polite"
    >
      <Spinner class="h-4 w-4" />
      <span>{{ reconnecting ? $t('connection.reconnecting') : $t('connection.syncing') }}</span>
    </div>
  </Transition>
</template>
