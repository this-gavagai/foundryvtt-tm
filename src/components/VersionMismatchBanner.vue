<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import Button from '@/components/widgets/ButtonWidget.vue'
import { useVersionCompatStore } from '@/stores/versionCompat'

// Surfaced when the connected Foundry module reports a different wire-protocol
// version than this app build (see stores/versionCompat.ts). Not dismissable:
// an incompatible module means RPCs can silently misbehave, so the only real
// remedy is to get both ends onto the same release.
const store = useVersionCompatStore()
const { isMismatched, moduleVersion } = storeToRefs(store)

const moduleVersionLabel = computed(() => moduleVersion.value ?? 'unknown')

function reload() {
  window.location.reload()
}
</script>

<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="-translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
  >
    <div
      v-if="isMismatched"
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
    </div>
  </Transition>
</template>
