<script setup lang="ts">
// The flat-modifier stepper shared by the roll builders: fixed ±1/±5 steps,
// the accumulated value, and a clear button once non-zero. The value itself
// lives with the caller (the damage builder derives it from the active
// damage group), so this only emits deltas.
defineProps<{
  value: number
}>()

const emit = defineEmits<{
  step: [delta: number]
  clear: []
}>()

const STEPS = [-5, -1, 1, 5]
</script>

<template>
  <div data-part="modifier-buttons" class="flex flex-wrap items-center gap-1">
    <button
      v-for="step in STEPS"
      :key="step"
      type="button"
      data-part="modifier-step"
      class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs font-medium whitespace-nowrap text-gray-900 select-none active:bg-gray-300"
      @click="emit('step', step)"
    >
      {{ step > 0 ? '+' + step : step }}
    </button>
    <span
      v-if="value !== 0"
      data-part="modifier-value"
      class="ml-1 min-w-6 text-center text-sm font-medium tabular-nums"
    >
      {{ value > 0 ? '+' + value : value }}
    </span>
    <button
      v-if="value !== 0"
      type="button"
      data-part="modifier-clear"
      class="cursor-pointer text-xs select-none"
      :aria-label="$t('sideMenu.clear')"
      @click="emit('clear')"
    >
      ✕
    </button>
  </div>
</template>
