<script setup lang="ts">
import { Tab } from '@headlessui/vue'
const props = defineProps(['src', 'label'])
</script>

<template>
  <Tab
    class="transition-color relative top-0 flex-1 touch-none p-2 outline-none duration-200 focus:outline-none ui-selected:bg-blue-200 ui-not-selected:bg-white ui-not-selected:hover:bg-blue-100 ui-not-selected:active:bg-blue-100 pwa:pb-6 pwa:md:pb-2"
  >
    <img
      :src="props.src"
      class="m-auto h-10 select-none"
      :alt="label + 'icon'"
      style="-webkit-touch-callout: none"
    />
    <!-- <div
      class="m-auto h-10 select-none bg-[url('assets/icons/plain-dagger.svg')] bg-contain bg-center bg-no-repeat"
    /> -->
    <span class="text-[.5rem]">
      {{ label }}
    </span>
  </Tab>
</template>
