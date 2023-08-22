<script setup lang="ts">
const props = defineProps(['heading'])
</script>
<template>
  <div>
    <div class="text-[0.8rem] uppercase">{{ heading }}</div>
    <div class="text-lg"><slot></slot></div>
  </div>
</template>
