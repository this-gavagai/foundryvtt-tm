<script setup lang="ts">
import type { Actor, Skill } from '@/types/pf2e-types'
import { inject, computed } from 'vue'
import Statistic from './Statistic.vue'
import { useKeys } from '@/composables/injectKeys'

const actor = inject(useKeys().actorKey)
</script>
<template>
  <div class="px-6 py-4 flex gap-4 border-b">
    <Statistic heading="AC" :modifiers="actor?.system?.attributes.ac?.modifiers" class="">
      <div class="w-8">
        {{ actor?.system?.attributes?.ac?.value ?? '??' }}
      </div>
    </Statistic>
    <div class="border border-gray-200"></div>
    <div class="my-auto">Shields stuff will go here</div>
  </div>
</template>
@/types/pf2e-types
