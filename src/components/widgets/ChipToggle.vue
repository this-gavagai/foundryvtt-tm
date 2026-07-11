<script setup lang="ts">
// The selectable chip token used across the roll builders (damage types,
// stat/save chits, trait options). A real button so it's keyboard-focusable;
// `data-active` drives the selected styling (and keeps existing test
// selectors working), `aria-pressed` carries the state for assistive tech.
// Extra classes (capitalize, italic) fall through from the caller.
defineProps<{
  active?: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <button
    type="button"
    :data-active="active ? '' : undefined"
    :aria-pressed="active"
    class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
    @click="emit('toggle')"
  >
    <slot></slot>
  </button>
</template>
