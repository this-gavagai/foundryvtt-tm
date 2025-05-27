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
    class="ui-selected:bg-blue-200 relative inline-flex flex-1 cursor-pointer items-center justify-center border-r border-gray-400 px-3 py-2 text-sm text-gray-900 last:border-r-0 hover:bg-blue-100 focus:z-10 active:bg-blue-300"
  >
    <img v-if="icon" :src="icon" class="h-6" :alt="'Choice icon ' + choice" />
    <div v-if="label" class="text-xs">{{ label }}</div>
  </button>
</template>
