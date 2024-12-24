<script setup lang="ts">
import { inject } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { fortitude, reflex, will } = character.saves
const { perception } = character
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox
      heading="Fort"
      modalHeading="Fortitude Save"
      :proficiency="fortitude?.rank"
      :modifiers="fortitude?.modifiers"
      :rollAction="fortitude?.roll"
    >
      {{ formatModifier(fortitude?.totalModifier) }}
    </StatBox>
    <StatBox
      heading="Refl"
      modalHeading="Reflex Save"
      :proficiency="reflex?.rank"
      :modifiers="reflex?.modifiers"
      :rollAction="reflex?.roll"
    >
      {{ formatModifier(reflex?.totalModifier) }}
    </StatBox>
    <StatBox
      heading="Will"
      modalHeading="Will Save"
      :proficiency="will?.rank"
      :modifiers="will?.modifiers"
      :rollAction="will?.roll"
    >
      {{ formatModifier(will?.totalModifier) }}
    </StatBox>
    <div class="border border-gray-200"></div>
    <StatBox
      heading="Perception"
      :proficiency="perception?.rank"
      :modifiers="perception?.modifiers"
      :rollAction="perception?.roll"
    >
      {{ formatModifier(perception?.totalModifier) }}
    </StatBox>
  </div>
</template>
