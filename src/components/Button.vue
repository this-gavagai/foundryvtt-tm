<script setup lang="ts">
// TODO: give this component some kind of feedback mechanism during promises
const props = defineProps<{ label: string }>()
</script>
<template>
  <button
    type="button"
    class="bg-gray-600 hover:bg-gray-500 text-white inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium focus:outline-none"
  >
    {{ props.label }}
  </button>
</template>
