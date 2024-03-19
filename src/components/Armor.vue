<script setup lang="ts">
// TODO: Make min-width so it doesn't alter size on reload and jiggle
import type { Actor, Skill } from '@/utils/pf2e-types'
import { inject, computed } from 'vue'
import Statistic from './Statistic.vue'

const actor: Actor = inject('actor')!
</script>
<template>
  <div class="px-6 py-4 flex gap-4 border-b">
    <Statistic heading="AC" :modifiers="actor?.system?.attributes.ac?.modifiers" class="">
      <div class="w-8">
        {{ actor?.system?.attributes?.ac?.value ?? 0 }}
      </div>
    </Statistic>
    <div class="border border-gray-200"></div>
    <div class="my-auto">Shields stuff will go here</div>
  </div>
</template>
