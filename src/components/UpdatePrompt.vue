<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import Button from '@/components/widgets/ButtonWidget.vue'

// `prompt` register type: useRegisterSW flips needRefresh.value to true when a
// new service-worker manifest is detected on page load. updateServiceWorker(true)
// activates the waiting SW and reloads the page so the user lands on the new
// build. Without this call, the new SW stays in 'waiting' state indefinitely.
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisterError(error) {
    console.error('SW registration failed', error)
  }
})

function reload() {
  updateServiceWorker(true)
}
function dismiss() {
  needRefresh.value = false
}
</script>
<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-full opacity-0"
  >
    <div
      v-if="needRefresh"
      data-component="UpdatePrompt"
      class="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
      role="status"
    >
      <span>{{ $t('updatePrompt.message') }}</span>
      <Button color="blue" :clicked="reload" :label="$t('updatePrompt.reload')" />
      <button
        type="button"
        class="cursor-pointer text-gray-400 hover:text-white"
        :aria-label="$t('common.close')"
        @click="dismiss"
      >
        ×
      </button>
    </div>
  </Transition>
</template>
