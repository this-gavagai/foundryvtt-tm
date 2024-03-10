<script setup lang="ts">
const props = defineProps(['heading', 'proficiency'])
const proficiencies = [
  'text-black',
  'text-blue-800',
  'text-purple-800',
  'text-yellow-800',
  'text-red-800'
]
</script>
<template>
  <div class="cursor-pointer">
    <div
      class="text-[0.8rem] uppercase whitespace-nowrap"
      :class="proficiencies[props.proficiency]"
    >
      {{ heading }}
    </div>
    <div class="text-lg"><slot></slot></div>
  </div>
</template>
