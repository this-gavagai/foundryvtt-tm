<script setup lang="ts">
import { ref } from 'vue'

import Spinner from '@/components/widgets/SpinnerWidget.vue'
const props = defineProps<{ label?: string; color?: string; clicked?: () => void }>()
const waiting = ref(false)

const styles = new Map([
  ['unstyled', ['active:text-gray-500', 'disabled:invisible', 'bg-transparent']],
  ['red', [`bg-red-600`, `hover:bg-red-500`, `active:bg-red-400`, 'text-white']],
  ['green', [`bg-green-600`, `hover:bg-green-500`, `active:bg-green-400`, 'text-white']],
  ['blue', [`bg-blue-600`, `hover:bg-blue-500`, `active:bg-blue-400`, 'text-white']],
  ['lightgray', [`bg-gray-300`, `active:bg-gray-200`, 'text-gray-900']],
  ['gray', [`bg-gray-600`, `hover:bg-gray-500`, `active:bg-gray-400`, 'text-white']],
  [undefined, []]
])

function handleClick() {
  if (props.clicked) {
    waiting.value = true
    const response = props.clicked?.()
    Promise.resolve(response).then(() => (waiting.value = false))
  }
}

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    class="inline-flex min-h-10 min-w-16 items-end justify-center border border-transparent px-4 py-2 font-medium transition-colors focus:outline-hidden disabled:opacity-50 initial:bg-gray-500"
    :class="[{ 'opacity-50': waiting }, ...(styles.get(props.color) ?? [])]"
    @click="handleClick"
  >
    <span :class="{ invisible: waiting }">
      <span class="whitespace-nowrap">{{ props?.label }}</span>
      <slot v-bind="{ waiting }"></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
