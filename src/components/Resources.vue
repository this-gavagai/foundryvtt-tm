<script setup lang="ts">
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import Experience from '@/components/Experience.vue'
</script>
<template>
  <div class="border border-t-0 px-6 py-4 flex gap-8">
    <HitPoints />
    <HeroPoints />
    <Experience />
  </div>
</template>
