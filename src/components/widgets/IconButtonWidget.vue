<script setup lang="ts">
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { useAsyncClick } from '@/composables/useAsyncClick'

const props = defineProps<{
  label: string
  disabled?: boolean
  clicked?: () => void
}>()

const { waiting, handleClick, handlePointerDown } = useAsyncClick(
  () => props.clicked?.(),
  () => props.disabled
)

defineExpose({ waiting })
</script>

<template>
  <button
    type="button"
    :aria-label="props.label"
    :disabled="props.disabled"
    class="relative inline-flex cursor-pointer items-center justify-center transition-colors focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
    @click="handleClick"
    @pointerdown="handlePointerDown"
  >
    <span :class="{ invisible: waiting }"><slot v-bind="{ waiting }" /></span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
