<script setup lang="ts">
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { useKeys } from '@/composables/injectKeys'

interface SpeedType {
  type: string | undefined
  total: number | undefined
  value: number | undefined
  totalModifier: number | undefined
}

const character = inject(useKeys().characterKey)!
const { land, swim, climb, fly, burrow } = character.movement

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
    <StatBox heading="Swim" :breakdown="swim?.breakdown" class="w-1/5">{{
      parseSpeed(swim)
    }}</StatBox>
    <StatBox heading="Climb" :breakdown="climb?.breakdown" class="w-1/5">{{
      parseSpeed(climb)
    }}</StatBox>
    <StatBox heading="Fly" :breakdown="fly?.breakdown" class="w-1/5">{{ parseSpeed(fly) }}</StatBox>
    <StatBox heading="Burrow" :breakdown="burrow?.breakdown" class="w-1/5">{{
      parseSpeed(burrow)
    }}</StatBox>
  </div>
</template>
