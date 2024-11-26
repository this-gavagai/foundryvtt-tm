<script setup lang="ts">
//TODO (feature): shield stuff
import type { Skill } from '@/types/pf2e-types'
import type { Character } from '@/composables/character'
import { inject, computed } from 'vue'
import Statistic from './Statistic.vue'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey) as Character
const { current: acCurrent, modifiers: acModifiers } = character.ac
</script>
<template>
  <div class="flex gap-4 border-b px-6 py-4">
    <Statistic heading="AC" :modifiers="acModifiers" class="">
      <div class="w-8">
        {{ acCurrent ?? '??' }}
      </div>
    </Statistic>
    <div class="border border-gray-200"></div>
    <div class="my-auto">Shield stuff will go here</div>
  </div>
</template>
