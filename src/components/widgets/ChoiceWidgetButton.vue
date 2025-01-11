<script setup lang="ts">
const { icon, label, choice, selected, disabled } = defineProps<{
  icon: string
  label: string
  choice: string
  selected: string
  disabled: boolean
}>()
</script>
<template>
  <button
    type="button"
    :disabled="disabled"
    :class="{ 'bg-blue-200': selected === choice }"
    class="relative inline-flex flex-1 items-center justify-center px-3 py-2 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:z-10 active:bg-blue-100"
  >
    <img v-if="icon" :src="icon" class="h-6" :alt="'Choice icon ' + choice" />
    <div v-if="label" class="text-xs">{{ label }}</div>
  </button>
</template>
