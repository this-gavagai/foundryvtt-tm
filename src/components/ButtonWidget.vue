<script setup lang="ts">
// TODO: simplify the color thing. Procedurally generated classnames don't work anyway with the builder.
import { ref, computed } from 'vue'

import Spinner from './SpinnerWidget.vue'
const props = defineProps<{ label?: string; color?: string }>()
const waiting = ref(false)
const colorStyles = computed(() => {
  const color = props.color ?? 'gray'
  if (color === 'unstyled') return ['active:text-gray-500', 'disabled:invisible']
  else if (color === 'red')
    return [`bg-red-600`, `hover:bg-red-500`, `active:bg-red-400`, 'text-white']
  else if (color === 'green')
    return [`bg-green-600`, `hover:bg-green-500`, `active:bg-green-400`, 'text-white']
  else if (color === 'blue')
    return [`bg-blue-600`, `hover:bg-blue-500`, `active:bg-blue-400`, 'text-white']
  else return [`bg-${color}-600`, `hover:bg-${color}-500`, `active:bg-${color}-400`, 'text-white']
})

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    class="font-mediumfocus:outline-none initial:bg-gray-500 inline-flex items-end justify-center border border-transparent px-4 py-2 text-sm disabled:opacity-50"
    :class="[{ 'opacity-50': waiting }, ...colorStyles]"
  >
    <span :class="{ invisible: waiting }">
      <span class="whitespace-nowrap">{{ props?.label }}</span>
      <slot></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
