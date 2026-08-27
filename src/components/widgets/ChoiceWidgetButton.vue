<script setup lang="ts">
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import ActionIcons from './ActionIcons.vue'

const {
  icon,
  glyph = '',
  label,
  choice,
  selected,
  disabled,
  size = 'md',
  direction = 'row'
} = defineProps<{
  icon: string
  glyph?: string
  label: string
  choice: string
  selected: string
  disabled: boolean
  size?: 'sm' | 'md'
  direction?: 'row' | 'column'
}>()
</script>
<template>
  <button
    type="button"
    :disabled="disabled"
    :data-selected="selected === choice ? true : undefined"
    class="relative inline-flex flex-1 cursor-pointer items-center text-sm focus:z-10 data-selected:bg-blue-200 data-selected:text-gray-900"
    :class="[
      size === 'sm' ? 'px-2 py-1' : 'px-3 py-2',
      // Stacked rows divide with a bottom border and spread their content;
      // segments in a row divide on the right and stay centred.
      direction === 'column'
        ? 'w-full justify-between gap-3 border-b border-gray-400 last:border-b-0'
        : 'justify-center border-r border-gray-400 last:border-r-0'
    ]"
    @pointerdown="!disabled && triggerLightHapticFeedback()"
  >
    <img
      v-if="icon"
      :src="icon"
      :class="size === 'sm' ? 'h-4' : 'h-6'"
      :alt="'Choice icon ' + choice"
    />
    <div v-if="label" class="min-w-0 truncate text-xs">{{ label }}</div>
    <ActionIcons v-if="glyph" class="shrink-0 text-xl leading-4" :actions="glyph" />
  </button>
</template>
