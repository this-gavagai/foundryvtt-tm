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
  <div class="flex justify-between px-6 py-4">
    <div class="flex w-7/12 justify-between">
      <StatBox
        heading="Fort"
        modalHeading="Fortitude Save"
        :proficiency="fortitude?.rank"
        :modifiers="fortitude?.modifiers"
        :rollAction="fortitude?.roll"
        class="w-1/3"
      >
        {{ formatModifier(fortitude?.totalModifier) }}
      </StatBox>
      <StatBox
        heading="Refl"
        modalHeading="Reflex Save"
        :proficiency="reflex?.rank"
        :modifiers="reflex?.modifiers"
        :rollAction="reflex?.roll"
        class="w-1/3"
      >
        {{ formatModifier(reflex?.totalModifier) }}
      </StatBox>
      <StatBox
        heading="Will"
        modalHeading="Will Save"
        :proficiency="will?.rank"
        :modifiers="will?.modifiers"
        :rollAction="will?.roll"
        class="w-1/3"
      >
        {{ formatModifier(will?.totalModifier) }}
      </StatBox>
    </div>
    <div class="border border-gray-200"></div>
    <StatBox
      heading="Perception"
      :proficiency="perception?.rank"
      :modifiers="perception?.modifiers"
      :rollAction="perception?.roll"
      class="w-1/3"
    >
      {{ formatModifier(perception?.totalModifier) }}
    </StatBox>
  </div>
</template>
