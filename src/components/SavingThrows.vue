<script setup lang="ts">
import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/formatters'
import { computed } from 'vue'
import { useInjectedActor } from '@/composables/injectKeys'
import { useDerivedStale } from '@/composables/useDerivedStale'
import { useProvisionalFigure } from '@/composables/useProvisionalFigure'

const character = useInjectedActor()
const { fortitude, reflex, will } = character.saves

// A save the sheet computed itself is marked, not presented as PF2e's. Each is
// wrapped separately because they diverge independently — a class feature can
// leave Fortitude provisional while Reflex is exact.
const derivedStale = useDerivedStale(character._id)
const mark = (save: typeof fortitude) =>
  useProvisionalFigure(
    derivedStale,
    computed(() => save.value?.provisional ?? undefined),
    computed(() => save.value?.caveat ?? undefined)
  ).attrs
const fortitudeAttrs = mark(fortitude)
const reflexAttrs = mark(reflex)
const willAttrs = mark(will)
</script>
<template>
  <div data-component="SavingThrows" class="contents">
    <StatBox
      :heading="$t('saves.fortitude')"
      :modalHeading="$t('savesFull.fortitude')"
      :proficiency="fortitude?.rank"
      :modifiers="fortitude?.modifiers"
      :total="fortitude?.totalModifier"
      :rollAction="fortitude?.roll"
    >
      <span v-bind="fortitudeAttrs">{{ formatModifier(fortitude?.totalModifier) }}</span>
    </StatBox>
    <StatBox
      :heading="$t('saves.reflex')"
      :modalHeading="$t('savesFull.reflex')"
      :proficiency="reflex?.rank"
      :modifiers="reflex?.modifiers"
      :total="reflex?.totalModifier"
      :rollAction="reflex?.roll"
    >
      <span v-bind="reflexAttrs">{{ formatModifier(reflex?.totalModifier) }}</span>
    </StatBox>
    <StatBox
      :heading="$t('saves.will')"
      :modalHeading="$t('savesFull.will')"
      :proficiency="will?.rank"
      :modifiers="will?.modifiers"
      :total="will?.totalModifier"
      :rollAction="will?.roll"
    >
      <span v-bind="willAttrs">{{ formatModifier(will?.totalModifier) }}</span>
    </StatBox>
  </div>
</template>
