<script setup lang="ts">
import { Tab } from '@headlessui/vue'
const props = defineProps(['src', 'label'])
</script>

<template>
  <Tab
    class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
    ><img :src="props.src" class="m-auto max-h-14" /><span class="text-[.5rem]">{{
      label
    }}</span></Tab
  >
</template>
