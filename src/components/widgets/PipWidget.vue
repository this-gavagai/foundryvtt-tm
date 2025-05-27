<script setup lang="ts">
const props = defineProps<{ filled: boolean }>()
</script>

<template>
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle
      cx="50"
      cy="50"
      r="40"
      :fill="props.filled ? 'currentColor' : 'transparent'"
      :stroke="'currentColor'"
      stroke-width="10"
      class="transition-all duration-200"
    />
  </svg>
</template>
