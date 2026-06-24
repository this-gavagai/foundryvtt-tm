<script setup lang="ts">
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
</script>
<template>
  <span
    class="inline-block cursor-pointer border border-gray-400 bg-gray-100 transition duration-180 ease-out select-none active:scale-[0.90] active:opacity-50 active:duration-60"
    style="-webkit-tap-highlight-color: transparent"
    @pointerdown="triggerLightHapticFeedback()"
  >
    <slot />
  </span>
</template>
