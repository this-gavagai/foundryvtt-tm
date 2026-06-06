<script setup lang="ts">
defineProps<{
  traits?: string[]
}>()
</script>

<template>
  <div v-if="traits?.length" data-component="TraitList" class="flex flex-wrap gap-1 pb-1">
    <span
      v-for="trait in traits"
      :key="trait"
      class="bg-[#5E0000] px-1 text-[0.5rem] text-white uppercase"
    >
      {{ trait }}
    </span>
  </div>
</template>
