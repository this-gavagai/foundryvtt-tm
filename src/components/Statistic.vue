<script setup lang="ts">
const props = defineProps(['heading'])
</script>
<template>
  <div>
    <div class="text-[0.8rem] uppercase whitespace-nowrap">{{ heading }}</div>
    <div class="text-lg"><slot></slot></div>
  </div>
</template>