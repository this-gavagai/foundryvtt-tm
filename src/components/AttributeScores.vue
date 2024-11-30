<script setup lang="ts">
// TODO: statbox should allow a full-name parameter. Right now, Reflex is showing up in the modal as "Refl"
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { str, dex, con, int, wis, cha } = character.attributes
const { fortitude, reflex, will } = character.saves
const { perception } = character
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox heading="Str">
      {{ formatModifier(str) }}
    </StatBox>
    <StatBox heading="Dex">
      {{ formatModifier(dex) }}
    </StatBox>
    <StatBox heading="Con">
      {{ formatModifier(con) }}
    </StatBox>
    <StatBox heading="Int">
      {{ formatModifier(int) }}
    </StatBox>
    <StatBox heading="Wis">
      {{ formatModifier(wis) }}
    </StatBox>
    <StatBox heading="Cha">
      {{ formatModifier(cha) }}
    </StatBox>
  </div>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox
      heading="Fort"
      modalHeading="Fortitude Save"
      :proficiency="fortitude?.rank"
      :modifiers="fortitude?.modifiers"
      :allowRoll="true"
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
