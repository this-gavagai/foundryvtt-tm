<script setup lang="ts">
import { ref } from 'vue'

import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
const props = defineProps<{
  label?: string
  color?: string
  disabled?: boolean
  clicked?: () => void
}>()
const waiting = ref(false)

const styles = new Map([
  ['unstyled', ['enabled:active:text-gray-500', 'disabled:invisible', 'bg-transparent']],
  ['red', [`bg-red-600`, `enabled:hover:bg-red-500`, `enabled:active:bg-red-400`, 'text-white']],
  ['green', [`bg-green-600`, `enabled:hover:bg-green-500`, `enabled:active:bg-green-400`, 'text-white']],
  ['blue', [`bg-blue-600`, `enabled:hover:bg-blue-500`, `enabled:active:bg-blue-400`, 'text-white']],
  ['lightgray', [`bg-gray-300`, `enabled:active:bg-gray-200`, 'text-gray-900']],
  ['gray', [`bg-gray-600`, `enabled:hover:bg-gray-500`, `enabled:active:bg-gray-400`, 'text-white']],
  [undefined, [`bg-gray-500`]]
])

function handleClick() {
  if (props.disabled) return
  if (props.clicked) {
    waiting.value = true
    const response = props.clicked?.()
    Promise.resolve(response).finally(() => (waiting.value = false))
  }
}

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    :disabled="props.disabled"
    :data-color="props.color"
    class="inline-flex min-h-10 min-w-16 cursor-pointer items-end justify-center border border-transparent px-4 py-2 font-medium transition-colors focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
    :class="[{ 'opacity-50': waiting }, ...(styles.get(props.color) ?? ['bg-gray-500'])]"
    @click="handleClick"
    @pointerdown="!props.disabled && triggerLightHapticFeedback()"
  >
    <span :class="{ invisible: waiting }">
      <span class="whitespace-nowrap">{{ props?.label }}</span>
      <slot v-bind="{ waiting }"></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
