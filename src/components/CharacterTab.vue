<script setup lang="ts">
const props = defineProps(['src', 'label'])
</script>

<template>
  <Tab class="p-2 ui-selected:bg-gray-200 focus:outline-none"
    ><img :src="'/../../' + props.src" class="h-8 w-8 m-auto" /><span class="text-[.5rem]">{{
      label
    }}</span></Tab
  >
</template>
