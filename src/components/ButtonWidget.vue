<script setup lang="ts">
import { ref } from 'vue'

import Spinner from './SpinnerWidget.vue'
const props = defineProps<{ label?: string; color?: string }>()
const waiting = ref(false)

const styles = new Map([
  ['unstyled', ['active:text-gray-500', 'disabled:invisible', 'bg-transparent']],
  ['red', [`bg-red-600`, `hover:bg-red-500`, `active:bg-red-400`, 'text-white']],
  ['green', [`bg-green-600`, `hover:bg-green-500`, `active:bg-green-400`, 'text-white']],
  ['blue', [`bg-blue-600`, `hover:bg-blue-500`, `active:bg-blue-400`, 'text-white']],
  ['gray', [`bg-gray-600`, `hover:bg-gray-500`, `active:bg-gray-400`, 'text-white']],
  [undefined, []]
])

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    class="inline-flex min-h-10 min-w-16 items-end justify-center border border-transparent px-4 py-2 font-medium transition-colors focus:outline-none disabled:opacity-50 initial:bg-gray-500"
    :class="[{ 'opacity-50': waiting }, ...(styles.get(props.color) ?? [])]"
  >
    <span :class="{ invisible: waiting }">
      <span class="whitespace-nowrap">{{ props?.label }}</span>
      <slot></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
