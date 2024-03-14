<script setup lang="ts">
import type { Actor, Skill } from '@/utils/pf2e-types'
import { inject } from 'vue'
import Statistic from './Statistic.vue'

const actor: Actor = inject('actor')!
</script>
<template>
  <div class="px-6 py-4 flex justify-between border-b">
    <Statistic heading="AC" :modifiers="actor.system?.attributes.ac?.modifiers">
      {{ actor.system?.attributes?.ac?.value }}
    </Statistic>
    <div class="border border-gray-200"></div>
    <div>No shield</div>
  </div>
</template>
