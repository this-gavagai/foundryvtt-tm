<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject, computed } from 'vue'
import Statistic from './Statistic.vue'
import { SignedNumber, formatModifier } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { attributes } from '@/utils/constants'
import { useKeys } from '@/composables/injectKeys'

const actor = inject(useKeys().actorKey)!
const speedLand = computed(() => actor.value?.system.attributes.speed.total)
const speedSwim = computed(() => {
  const speed = actor.value?.system.attributes.speed.otherSpeeds.find((s: any) => s.type === 'swim')
  return speed?.total ?? speed?.value
})
const speedClimb = computed(() => {
  const speed = actor.value?.system.attributes.speed.otherSpeeds.find(
    (s: any) => s.type === 'climb'
  )
  return speed?.total ?? speed?.value
})
const speedFly = computed(() => {
  const speed = actor.value?.system.attributes.speed.otherSpeeds.find((s: any) => s.type === 'fly')
  return speed?.total ?? speed?.value
})
const speedBurrow = computed(() => {
  const speed = actor.value?.system.attributes.speed.otherSpeeds.find(
    (s: any) => s.type === 'burrow'
  )
  return speed?.total ?? speed?.value
})
</script>
<template>
  <div class="px-6 py-4 flex justify-between border-b">
    <Statistic heading="Land">{{ speedLand ?? '--' }}</Statistic>
    <Statistic heading="Swim">{{ speedSwim ?? '--' }}</Statistic>
    <Statistic heading="Climb">{{ speedClimb ?? '--' }}</Statistic>
    <Statistic heading="Fly">{{ speedFly ?? '--' }}</Statistic>
    <Statistic heading="Burrow">{{ speedBurrow ?? '--' }}</Statistic>
  </div>
</template>
