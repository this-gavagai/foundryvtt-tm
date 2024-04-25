<script setup lang="ts">
import { inject, computed } from 'vue'
import Statistic from './Statistic.vue'
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
    <Statistic heading="Land">{{ speedLand ?? '--' }}</Statistic>
    <Statistic heading="Swim">{{ speedSwim ?? '--' }}</Statistic>
    <Statistic heading="Climb">{{ speedClimb ?? '--' }}</Statistic>
    <Statistic heading="Fly">{{ speedFly ?? '--' }}</Statistic>
    <Statistic heading="Burrow">{{ speedBurrow ?? '--' }}</Statistic>
  </div>
</template>
