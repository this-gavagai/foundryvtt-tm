<script setup lang="ts">
import { computed, type ComputedRef } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { useInjectedActor } from '@/composables/injectKeys'
import { useDerivedStale } from '@/composables/useDerivedStale'
import { useProvisionalFigure } from '@/composables/useProvisionalFigure'
import type { Stat } from '@/composables/character'

import d20 from '@/assets/icons/d20.svg'

const character = useInjectedActor()
const { _id } = character
const { land, swim, climb, fly, burrow } = character.movement
const { skills } = character

const athletics = computed(() => skills.value?.find((s) => s.slug === 'athletics'))

// Speeds are prepared data, so the whole panel is the engine's without a GM.
// One marker helper per speed, since they can differ: a land speed derived from
// the ancestry can be exact while a granted fly speed is provisional.
const derivedStale = useDerivedStale(_id)
const marks = (speed: ComputedRef<Stat | undefined>) =>
  useProvisionalFigure(
    derivedStale,
    computed(() => speed.value?.provisional ?? undefined),
    computed(() => speed.value?.caveat ?? undefined)
  ).attrs
const landMarks = marks(land)
const swimMarks = marks(swim)
const climbMarks = marks(climb)
const flyMarks = marks(fly)
const burrowMarks = marks(burrow)

function parseSpeed(speed: Stat | undefined) {
  if (speed?.value) return speed?.value
  if (typeof speed?.value !== 'undefined' && typeof speed?.totalModifier !== 'undefined')
    return speed?.value + speed?.totalModifier
  else return '--'
}
</script>
<template>
  <div data-component="MovementSpeed">
    <div data-part="heading" class="pb-[0.35rem] text-[0.8rem] font-normal uppercase">
      {{ $t('movement.heading') }}
    </div>
    <div data-part="speeds" class="flex justify-between gap-1 *:w-1/5">
      <StatBox :heading="$t('movement.land')" :breakdown="land?.breakdown">
        <span v-bind="landMarks">{{ parseSpeed(land) }}</span>
      </StatBox>
      <div>
        <StatBox v-if="swim?.value" :heading="$t('movement.swim')" :breakdown="swim?.breakdown">
          <span v-bind="swimMarks">{{ parseSpeed(swim) }}</span>
        </StatBox>
        <StatBox
          v-else
          :heading="$t('movement.swim')"
          :modalHeading="$t('movement.athleticsSwim')"
          :modifiers="athletics?.modifiers"
          :rollAction="athletics?.roll"
        >
          <img
            v-if="land?.value"
            :src="d20"
            class="mx-auto mt-1 h-6 w-5"
            style="stroke: currentColor"
          />
          <span v-else>--</span>
        </StatBox>
      </div>
      <div>
        <StatBox v-if="climb?.value" :heading="$t('movement.climb')" :breakdown="climb?.breakdown">
          <span v-bind="climbMarks">{{ parseSpeed(climb) }}</span>
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
      <StatBox :heading="$t('movement.burrow')" :breakdown="burrow?.breakdown">
        <span v-bind="burrowMarks">{{ parseSpeed(burrow) }}</span>
      </StatBox>
      <StatBox :heading="$t('movement.fly')" :breakdown="fly?.breakdown">
        <span v-bind="flyMarks">{{ parseSpeed(fly) }}</span>
      </StatBox>
    </div>
  </div>
</template>
