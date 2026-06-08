<script setup lang="ts">
import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/formatters'
import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { fortitude, reflex, will } = character.saves
</script>
<template>
  <div data-component="SavingThrows" class="flex grow justify-around gap-2">
    <StatBox
      :heading="$t('saves.fortitude')"
      :modalHeading="$t('savesFull.fortitude')"
      :proficiency="fortitude?.rank"
      :modifiers="fortitude?.modifiers"
      :rollAction="fortitude?.roll"
    >
      {{ formatModifier(fortitude?.totalModifier) }}
    </StatBox>
    <StatBox
      :heading="$t('saves.reflex')"
      :modalHeading="$t('savesFull.reflex')"
      :proficiency="reflex?.rank"
      :modifiers="reflex?.modifiers"
      :rollAction="reflex?.roll"
    >
      {{ formatModifier(reflex?.totalModifier) }}
    </StatBox>
    <StatBox
      :heading="$t('saves.will')"
      :modalHeading="$t('savesFull.will')"
      :proficiency="will?.rank"
      :modifiers="will?.modifiers"
      :rollAction="will?.roll"
    >
      {{ formatModifier(will?.totalModifier) }}
    </StatBox>
  </div>
</template>
