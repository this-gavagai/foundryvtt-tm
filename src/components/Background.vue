<script setup lang="ts">
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import ExperiencePoints from '@/components/ExperiencePoints.vue'
import AncestryBackgroundClass from './AncestryBackgroundClass.vue'
</script>
<template>
  <div class="flex justify-between gap-2 border-b px-6 py-4 align-bottom">
    <AncestryBackgroundClass />
    <ExperiencePoints />
  </div>
</template>
