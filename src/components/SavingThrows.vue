<script setup lang="ts">

import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { fortitude, reflex, will } = character.saves
const { perception } = character
</script>
<template>
  <div class="flex justify-between px-6 py-4">
    <div class="flex w-7/12 justify-between gap-2">
      <StatBox
        :heading="$t('saves.fortitude')"
        :modalHeading="$t('savesFull.fortitude')"
        :proficiency="fortitude?.rank"
        :modifiers="fortitude?.modifiers"
        :rollAction="fortitude?.roll"
        class="w-1/3"
      >
        {{ formatModifier(fortitude?.totalModifier) }}
      </StatBox>
      <StatBox
        :heading="$t('saves.reflex')"
        :modalHeading="$t('savesFull.reflex')"
        :proficiency="reflex?.rank"
        :modifiers="reflex?.modifiers"
        :rollAction="reflex?.roll"
        class="w-1/3"
      >
        {{ formatModifier(reflex?.totalModifier) }}
      </StatBox>
      <StatBox
        :heading="$t('saves.will')"
        :modalHeading="$t('savesFull.will')"
        :proficiency="will?.rank"
        :modifiers="will?.modifiers"
        :rollAction="will?.roll"
        class="w-1/3"
      >
        {{ formatModifier(will?.totalModifier) }}
      </StatBox>
    </div>
    <div class="border-divider border"></div>
    <StatBox
      :heading="$t('saves.perception')"
      :proficiency="perception?.rank"
      :modifiers="perception?.modifiers"
      :rollAction="perception?.roll"
      class="w-1/3"
    >
      {{ formatModifier(perception?.totalModifier) }}
    </StatBox>
  </div>
</template>
