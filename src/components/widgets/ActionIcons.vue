<script setup lang="ts">
import { computed } from 'vue'
import { actionCost } from '@/utils/actionCost'

const props = defineProps<{ actions: string | number | undefined | null }>()

const cost = computed(() => actionCost(props.actions))
</script>
<template>
  <span v-if="cost.kind === 'glyph'" class="pf2-icon">{{ cost.glyph }}</span>
  <!-- A prose cost ("10 minutes") lands in a slot every caller sized for an
       icon — text-2xl, -mt-2, a zero-height float. Those are undone here so
       the words read at the sheet's own size wherever the icon would have
       gone. Unlayered, so they beat the Tailwind utilities on this element. -->
  <span v-else class="pf2-cost-text">{{ cost.text }}</span>
</template>
<style scoped>
@font-face {
  font-family: Pathfinder2eActions;
  src: url(@/assets/Pathfinder2eActions.ttf);
  font-display: block;
}
.pf2-icon {
  font-family: 'Pathfinder2eActions', sans-serif;
}
.pf2-cost-text {
  font-size: 0.8125rem;
  line-height: 1.2;
  margin-top: 0;
  float: none;
  height: auto;
  white-space: nowrap;
}
.pf2-cost-text:empty {
  display: none;
}
</style>
