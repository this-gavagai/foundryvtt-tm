<script setup lang="ts">
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

const props = defineProps<{
  label: string
  disabled?: boolean
}>()
</script>

<template>
  <button
    type="button"
    :aria-label="props.label"
    :disabled="props.disabled"
    class="inline-flex cursor-pointer items-center justify-center transition-colors focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
    @pointerdown="!props.disabled && triggerLightHapticFeedback()"
  >
    <slot />
  </button>
</template>
