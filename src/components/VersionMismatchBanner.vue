<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import Button from '@/components/widgets/ButtonWidget.vue'
import { useVersionCompatStore } from '@/stores/versionCompat'

// Warns when the connected Foundry module reports a different wire-protocol
// version than this app build (see stores/versionCompat.ts). Purely advisory:
// it doesn't block the app, and the user can dismiss it for the session.
const store = useVersionCompatStore()
const { isMismatched, moduleVersion } = storeToRefs(store)

const dismissed = ref(false)
const show = computed(() => isMismatched.value && !dismissed.value)

const moduleVersionLabel = computed(() => moduleVersion.value ?? 'unknown')

function reload() {
  window.location.reload()
}
function dismiss() {
  dismissed.value = true
}
</script>

<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="duration-150 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="-translate-y-full opacity-0"
  >
    <div
      v-if="show"
      data-component="VersionMismatchBanner"
      class="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-red-800 bg-red-900 px-4 py-3 text-sm text-white shadow-lg"
      role="alert"
    >
      <span class="font-semibold">{{ $t('versionMismatch.title') }}</span>
      <span>
        {{
          $t('versionMismatch.message', {
            appVersion: store.appVersion,
            moduleVersion: moduleVersionLabel
          })
        }}
      </span>
      <Button color="blue" :clicked="reload" :label="$t('versionMismatch.reload')" />
      <button
        type="button"
        class="cursor-pointer px-1 text-white/70 hover:text-white"
        :aria-label="$t('common.close')"
        @click="dismiss"
      >
        ×
      </button>
    </div>
  </Transition>
</template>
