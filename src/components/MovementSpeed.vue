<script setup lang="ts">
import { inject, computed } from 'vue'
import StatBox from './StatBox.vue'
import { useKeys } from '@/composables/injectKeys'

interface SpeedType {
  type: string
  total: number
  value: number
  totalModifier: number
}

const actor = inject(useKeys().actorKey)!
const speedLand = computed(() => actor.value?.system.attributes.speed.total)
const speedSwim = computed(() => {
  const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
    (s: SpeedType) => s.type === 'swim'
  )
  return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
})
const speedClimb = computed(() => {
  const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
    (s: SpeedType) => s.type === 'climb'
  )
  return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
})
const speedFly = computed(() => {
  const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
    (s: SpeedType) => s.type === 'fly'
  )
  return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
})
const speedBurrow = computed(() => {
  const spd = actor.value?.system.attributes.speed.otherSpeeds.find(
    (s: SpeedType) => s.type === 'burrow'
  )
  return (spd?.total ?? spd?.value + spd?.totalModifier) || undefined
})
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox heading="Land">{{ speedLand ?? '--' }}</StatBox>
    <StatBox heading="Swim">{{ speedSwim ?? '--' }}</StatBox>
    <StatBox heading="Climb">{{ speedClimb ?? '--' }}</StatBox>
    <StatBox heading="Fly">{{ speedFly ?? '--' }}</StatBox>
    <StatBox heading="Burrow">{{ speedBurrow ?? '--' }}</StatBox>
  </div>
</template>
