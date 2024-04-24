<script setup lang="ts">
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import Experience from '@/components/Experience.vue'
import AncestryBackgroundClass from './AncestryBackgroundClass.vue'
</script>
<template>
  <div class="border-b px-6 py-4 flex gap-2 justify-between align-bottom">
    <AncestryBackgroundClass />
    <Experience />
  </div>
</template>
