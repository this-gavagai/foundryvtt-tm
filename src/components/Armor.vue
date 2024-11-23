<script setup lang="ts">
//TODO (feature): shield stuff
import type { Actor, Skill } from '@/types/pf2e-types'
import { inject, computed } from 'vue'
import Statistic from './Statistic.vue'
import { useKeys } from '@/composables/injectKeys'

const actor = inject(useKeys().actorKey)
</script>
<template>
  <div class="flex gap-4 border-b px-6 py-4">
    <Statistic heading="AC" :modifiers="actor?.system?.attributes.ac?.modifiers" class="">
      <div class="w-8">
        {{ actor?.system?.attributes?.ac?.value ?? '??' }}
      </div>
    </Statistic>
    <div class="border border-gray-200"></div>
    <div class="my-auto">Shield stuff will go here</div>
  </div>
</template>
