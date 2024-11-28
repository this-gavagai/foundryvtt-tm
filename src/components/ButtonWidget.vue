<script setup lang="ts">
import { ref } from 'vue'

import Spinner from './SpinnerWidget.vue'
const props = defineProps<{ label?: string }>()
const waiting = ref(false)

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    class="inline-flex items-end justify-center border border-transparent px-4 py-2 text-sm font-medium focus:outline-none"
    :class="{ 'opacity-50': waiting }"
  >
    <span :class="{ invisible: waiting }">
      <span>{{ props.label }}</span>
      <slot></slot>
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
