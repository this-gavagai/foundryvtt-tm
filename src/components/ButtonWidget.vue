<script setup lang="ts">
import { ref, computed } from 'vue'

import Spinner from './SpinnerWidget.vue'
const props = defineProps<{ label?: string; color?: string }>()
const waiting = ref(false)
const colorStyles = computed(() => {
  const color = props.color ?? 'gray'
  if (color === 'unstyled') return ['active:text-gray-500', 'disabled:invisible']
  else return [`bg-${color}-600`, `hover:bg-${color}-500`, `active:bg-${color}-400`, 'text-white']
})

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    class="font-mediumfocus:outline-none inline-flex items-end justify-center border border-transparent px-4 py-2 text-sm disabled:opacity-50"
    :class="[{ 'opacity-50': waiting }, ...colorStyles]"
  >
    <span :class="{ invisible: waiting }">
      <span class="whitespace-nowrap">{{ props?.label }}</span>
      <slot></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
