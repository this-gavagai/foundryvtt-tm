<script setup lang="ts">
const props = defineProps<{ actions: string | undefined }>()
</script>
<template>
  <span class="pf2-icon">
    {{ props.actions?.replace('to', '-').replace('free', 'f').replace('reaction', 'r') ?? '' }}
  </span>
</template>
