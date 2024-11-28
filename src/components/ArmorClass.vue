<script setup lang="ts">
//TODO (feature): shield stuff
import type { Character } from '@/composables/character'
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey) as Character
const { current: acCurrent, modifiers: acModifiers } = character.ac
</script>
<template>
  <div class="flex gap-4 border-b px-6 py-4">
    <StatBox heading="AC" :modifiers="acModifiers" class="">
      <div class="w-8">
        {{ acCurrent ?? '??' }}
      </div>
    </StatBox>
    <div class="border border-gray-200"></div>
    <div class="my-auto">Shield stuff will go here</div>
  </div>
</template>
