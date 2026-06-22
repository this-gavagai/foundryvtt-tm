<script setup lang="ts">
import { Tab } from '@headlessui/vue'
const props = defineProps(['src', 'label'])
</script>

<template>
  <Tab
    data-part="tab"
    class="group transition-color ui-selected:bg-selected ui-not-selected:bg-inherit hover:ui-not-selected:bg-hovered active:ui-not-selected:bg-active pwa:pb-6 pwa:md:pb-2 relative top-0 flex-1 cursor-pointer touch-none p-2 outline-hidden duration-200 focus:outline-hidden"
  >
    <img
      :src="props.src"
      class="m-auto h-10 select-none transition duration-200 ease-out group-active:scale-90 group-active:opacity-50 group-active:duration-60"
      :alt="label + 'icon'"
      style="-webkit-touch-callout: none"
    />
    <!-- <div
      class="m-auto h-10 select-none bg-[url('assets/icons/plain-dagger.svg')] bg-contain bg-center bg-no-repeat"
    /> -->
    <div
      class="overflow-hidden text-[.5rem] whitespace-normal transition duration-200 ease-out group-active:scale-90 group-active:opacity-50 group-active:duration-60"
    >
      {{ label }}
    </div>
  </Tab>
</template>
