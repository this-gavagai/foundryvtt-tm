<script setup lang="ts">
import { computed } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import type { Stat } from '@/composables/character'

import d20 from '@/assets/icons/d20.svg'

const character = useInjectedCharacter()
const { land, swim, climb, fly, burrow } = character.movement
const { skills } = character

const athletics = computed(() => skills.value?.find((s) => s.slug === 'athletics'))

function parseSpeed(speed: Stat | undefined) {
  if (speed?.value) return speed?.value
  if (typeof speed?.value !== 'undefined' && typeof speed?.totalModifier !== 'undefined')
    return speed?.value + speed?.totalModifier
  else return '--'
}
</script>
<template>
  <div class="flex justify-between gap-1">
    <StatBox :heading="$t('movement.land')" :breakdown="land?.breakdown" class="w-1/5">
      {{ parseSpeed(land) }}
    </StatBox>
    <div class="w-1/5">
      <StatBox v-if="swim?.value" :heading="$t('movement.swim')" :breakdown="swim?.breakdown">
        {{ parseSpeed(swim) }}
      </StatBox>
      <StatBox
        v-else
        :heading="$t('movement.swim')"
        :modalHeading="$t('movement.athleticsSwim')"
        :modifiers="athletics?.modifiers"
        :rollAction="athletics?.roll"
      >
        <img v-if="land?.value" :src="d20" class="mx-auto mt-1 h-6 w-5" style="stroke: currentColor" />
        <span v-else>--</span>
      </StatBox>
    </div>
    <div class="w-1/5">
      <StatBox v-if="climb?.value" :heading="$t('movement.climb')" :breakdown="climb?.breakdown">
        {{ parseSpeed(climb) }}
      </StatBox>
      <StatBox
        v-else
        :heading="$t('movement.climb')"
        :modalHeading="$t('movement.athleticsClimb')"
        :modifiers="athletics?.modifiers"
        :rollAction="athletics?.roll"
      >
        <img v-if="land?.value" :src="d20" class="mx-auto mt-1 h-6 w-5" />
        <span v-else>--</span>
      </StatBox>
    </div>
    <StatBox :heading="$t('movement.fly')" :breakdown="fly?.breakdown" class="w-1/5">
      {{ parseSpeed(fly) }}
    </StatBox>
    <StatBox :heading="$t('movement.burrow')" :breakdown="burrow?.breakdown" class="w-1/5">
      {{ parseSpeed(burrow) }}
    </StatBox>
  </div>
</template>
