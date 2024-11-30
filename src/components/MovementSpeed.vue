<script setup lang="ts">
// TODO: add modifiers view and roll option for climb/swim
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

// const speedLand = computed(() => actor.value?.system.attributes.speed.total)
// const speedSwim = computed(() => {
//   const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
//     (s: SpeedType) => s.type === 'swim'
//   )
//   return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
// })
// const speedClimb = computed(() => {
//   const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
//     (s: SpeedType) => s.type === 'climb'
//   )
//   return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
// })
// const speedFly = computed(() => {
//   const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
//     (s: SpeedType) => s.type === 'fly'
//   )
//   return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
// })
// const speedBurrow = computed(() => {
//   const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
//     (s: SpeedType) => s.type === 'burrow'
//   )
//   return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
// })
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox heading="Land" class="w-1/5">{{ parseSpeed(land) }}</StatBox>
    <StatBox heading="Swim" class="w-1/5">{{ parseSpeed(swim) }}</StatBox>
    <StatBox heading="Climb" class="w-1/5">{{ parseSpeed(climb) }}</StatBox>
    <StatBox heading="Fly" class="w-1/5">{{ parseSpeed(fly) }}</StatBox>
    <StatBox heading="Burrow" class="w-1/5">{{ parseSpeed(burrow) }}</StatBox>
  </div>
</template>
