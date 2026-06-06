<script setup lang="ts">
// TODO: refactor this to handle actions structure more cleanly
const props = defineProps<{ actions: string | undefined }>()
</script>
<template>
  <span class="pf2-icon">
    <!-- {{ props.actions?.replace('to', '-').replace('free', 'f').replace('reaction', 'r') ?? '' }} -->
    {{ props.actions?.replace('to', '-').replace('free', 'f').replace('reaction', 'r') ?? '' }}
  </span>
</template>
<style scoped>
@font-face {
  font-family: Pathfinder2eActions;
  src: url(@/assets/Pathfinder2eActions.ttf);
  font-display: block;
}
.pf2-icon {
  font-family: 'Pathfinder2eActions', sans-serif;
  /* padding-bottom: 12px; */
}
</style>
