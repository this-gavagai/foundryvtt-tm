<script setup lang="ts">
const props = defineProps<{ actions: string | undefined }>()
</script>
<template>
  <span class="pf2-icon">
    {{ props.actions?.replace('to', '-').replace('free', 'f').replace('reaction', 'r') ?? '' }}
  </span>
</template>
<style scoped>
@font-face {
  font-family: Pathfinder2eActions;
  src: url(@/assets/Pathfinder2eActions.ttf);
}
.pf2-icon {
  font-family: 'Pathfinder2eActions', sans-serif;
  padding-bottom: 12px;
}
</style>
