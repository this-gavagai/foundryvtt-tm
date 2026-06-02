<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@/stores/server'
import Spinner from '@/components/widgets/SpinnerWidget.vue'

// Visible only after the *first* successful connection — during the initial
// cold-load the app shell shows a spinner instead, and a banner would be
// redundant noise. The flag flips true on the first transition into
// `isConnected` and stays there for the rest of the session.
const { isConnected } = storeToRefs(useServerStore())
const hasEverConnected = ref(false)
watch(
  isConnected,
  (val) => {
    if (val) hasEverConnected.value = true
  },
  { immediate: true }
)

const visible = computed(() => hasEverConnected.value && !isConnected.value)
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
      <span>{{ $t('connection.reconnecting') }}</span>
    </div>
  </Transition>
</template>
