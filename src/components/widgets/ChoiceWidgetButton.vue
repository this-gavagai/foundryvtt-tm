<script setup lang="ts">
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

const {
  icon,
  label,
  choice,
  selected,
  disabled,
  size = 'md'
} = defineProps<{
  icon: string
  label: string
  choice: string
  selected: string
  disabled: boolean
  size?: 'sm' | 'md'
}>()
</script>
<template>
  <button
    type="button"
    :disabled="disabled"
    :data-selected="selected === choice ? true : undefined"
    class="relative inline-flex flex-1 cursor-pointer items-center justify-center border-r border-gray-400 text-sm last:border-r-0 focus:z-10 data-selected:bg-blue-200 data-selected:text-gray-900"
    :class="size === 'sm' ? 'px-2 py-1' : 'px-3 py-2'"
    @pointerdown="!disabled && triggerLightHapticFeedback()"
  >
    <img
      v-if="icon"
      :src="icon"
      :class="size === 'sm' ? 'h-4' : 'h-6'"
      :alt="'Choice icon ' + choice"
    />
    <div v-if="label" class="text-xs">{{ label }}</div>
  </button>
</template>
