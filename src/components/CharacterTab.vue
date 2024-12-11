<script setup lang="ts">
import { Tab } from '@headlessui/vue'
const props = defineProps(['src', 'label'])
</script>

<template>
  <Tab
    class="transition-color pwa:pb-6 relative top-0 flex-1 p-2 focus:outline-none ui-selected:bg-blue-200 ui-not-selected:bg-white ui-not-selected:hover:bg-blue-100 ui-not-selected:active:bg-blue-100"
  >
    <img :src="props.src" class="m-auto h-10 select-none" />
    <span class="text-[.5rem]">
      {{ label }}
    </span>
  </Tab>
</template>
