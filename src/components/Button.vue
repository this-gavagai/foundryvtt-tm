<script setup lang="ts">
import { ref } from 'vue'

import Spinner from './Spinner.vue'
const props = defineProps<{ label: string }>()
const waiting = ref(false)

defineExpose({ waiting })
</script>
<template>
  <button
    type="button"
    class="bg-gray-600 hover:bg-gray-500 text-white inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium focus:outline-none"
    :class="{ 'opacity-50': waiting }"
  >
    <span :class="{ invisible: waiting }">
      {{ props.label }}
    </span>
    <span class="absolute" :class="{ invisible: !waiting }"><Spinner class="h-5" /></span>
  </button>
</template>
