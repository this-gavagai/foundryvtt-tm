<script setup lang="ts">
const props = defineProps<{ value: number; max?: number }>()
</script>
<template>
  <span>
    <span v-for="i in props.value">●</span>
    <span v-if="props.max" v-for="i in props.max - props.value">○</span>
  </span>
</template>
