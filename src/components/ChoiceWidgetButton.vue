<script setup lang="ts">
const { icon, choice, selected, disabled } = defineProps<{
  icon: string
  choice: string
  selected: string
  disabled: boolean
}>()
</script>
<template>
  <button
    type="button"
    class="relative inline-flex items-center px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 focus:z-10 active:bg-blue-100"
    :disabled="disabled"
    :class="{ 'bg-blue-200': selected === choice }"
  >
    <img :src="icon" class="h-6" />
  </button>
</template>
