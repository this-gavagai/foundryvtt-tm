<script setup lang="ts">
import { inject, computed } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { useKeys } from '@/composables/injectKeys'

import d20 from '@/assets/icons/d20.svg'

interface SpeedType {
  type: string | undefined
  total: number | undefined
  value: number | undefined
  totalModifier: number | undefined
}

const character = inject(useKeys().characterKey)!
const { land, swim, climb, fly, burrow } = character.movement
const { skills } = character

const athletics = computed(() => skills.value?.find((s) => s.slug === 'athletics'))

function parseSpeed(speed: SpeedType | undefined) {
  if (speed?.total) return speed?.total
  if (typeof speed?.value !== 'undefined' && typeof speed?.totalModifier !== 'undefined')
    return speed?.value + speed?.totalModifier
  else return '--'
}
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox heading="Land" :breakdown="land?.breakdown" class="w-1/5">{{
      parseSpeed(land)
    }}</StatBox>
    <div class="w-1/5">
      <StatBox v-if="swim?.value" heading="Swim" :breakdown="swim?.breakdown">{{
        parseSpeed(swim)
      }}</StatBox>
      <StatBox
        v-else
        heading="Swim"
        modalHeading="Athletics Check (Swim)"
        :modifiers="athletics?.modifiers"
        :rollAction="athletics?.roll"
      >
        <img :src="d20" class="mt-1 h-5 w-6" />
      </StatBox>
    </div>
    <div class="w-1/5">
      <StatBox v-if="climb?.value" heading="Climb" :breakdown="climb?.breakdown">{{
        parseSpeed(climb)
      }}</StatBox>
      <StatBox
        v-else
        heading="Climb"
        modalHeading="Athletics Check (Climb)"
        :modifiers="athletics?.modifiers"
        :rollAction="athletics?.roll"
      >
        <img :src="d20" class="mt-1 h-5 w-5" />
      </StatBox>
    </div>
    <StatBox heading="Fly" :breakdown="fly?.breakdown" class="w-1/5">{{ parseSpeed(fly) }}</StatBox>
    <StatBox heading="Burrow" :breakdown="burrow?.breakdown" class="w-1/5">{{
      parseSpeed(burrow)
    }}</StatBox>
  </div>
</template>
