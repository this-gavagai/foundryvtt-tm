<script setup lang="ts">
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { useAsyncClick } from '@/composables/useAsyncClick'
const props = defineProps<{
  label?: string
  color?: string
  disabled?: boolean
  clicked?: () => void
}>()
const { waiting, failed, handleClick, handlePointerDown } = useAsyncClick(
  () => props.clicked?.(),
  () => props.disabled
)

const styles = new Map([
  ['unstyled', ['enabled:active:text-gray-500', 'disabled:invisible', 'bg-transparent']],
  ['red', [`bg-red-600`, `enabled:hover:bg-red-500`, `enabled:active:bg-red-400`, 'text-white']],
  [
    'green',
    [`bg-green-600`, `enabled:hover:bg-green-500`, `enabled:active:bg-green-400`, 'text-white']
  ],
  [
    'blue',
    [`bg-blue-600`, `enabled:hover:bg-blue-500`, `enabled:active:bg-blue-400`, 'text-white']
  ],
  ['lightgray', [`bg-gray-300`, `enabled:active:bg-gray-200`, 'text-gray-900']],
  [
    'gray',
    [`bg-gray-600`, `enabled:hover:bg-gray-500`, `enabled:active:bg-gray-400`, 'text-white']
  ],
  [undefined, [`bg-gray-500`]]
])

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    :disabled="props.disabled"
    :data-color="props.color"
    class="inline-flex min-h-10 min-w-16 cursor-pointer items-end justify-center border px-4 py-2 font-medium transition-colors focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      // Failure flash: a red border (box-sizing is border-box, so the reserved
      // transparent border means zero layout shift). Not a `ring` — Tailwind's
      // ring doesn't compose to box-shadow under this app's CSS reset — nor an
      // `outline`, which the button's focus:outline-hidden would suppress while
      // it's focused (which it is, right after the click that failed).
      { 'opacity-50': waiting, 'border-red-500': failed, 'border-transparent': !failed },
      ...(styles.get(props.color) ?? ['bg-gray-500'])
    ]"
    @click="handleClick"
    @pointerdown="handlePointerDown"
  >
    <span :class="{ invisible: waiting }">
      <span class="whitespace-nowrap">{{ props?.label }}</span>
      <slot v-bind="{ waiting }"></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
