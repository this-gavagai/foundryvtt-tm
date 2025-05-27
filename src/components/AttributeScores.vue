<script setup lang="ts">
import { inject } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { str, dex, con, int, wis, cha } = character.attributes
</script>
<template>
  <div class="flex justify-between px-6 py-4 [&>*]:w-1/6">
    <StatBox
      heading="Str"
      fullHeading="Strength"
      data-attribute-type="str"
      :data-attribute-score="str"
    >
      {{ formatModifier(str) }}
    </StatBox>
    <StatBox
      heading="Dex"
      fullHeading="Dexterity"
      data-attribute-type="dex"
      :data-attribute-score="dex"
    >
      {{ formatModifier(dex) }}
    </StatBox>
    <StatBox
      heading="Con"
      fullHeading="Constitution"
      data-attribute-type="con"
      :data-attribute-score="con"
    >
      {{ formatModifier(con) }}
    </StatBox>
    <StatBox
      heading="Int"
      fullHeading="Intelligence"
      data-attribute-type="int"
      :data-attribute-score="int"
    >
      {{ formatModifier(int) }}
    </StatBox>
    <StatBox
      heading="Wis"
      fullHeading="Wisdom"
      data-attribute-type="wis"
      :data-attribute-score="wis"
    >
      {{ formatModifier(wis) }}
    </StatBox>
    <StatBox
      heading="Cha"
      fullHeading="Charisma"
      data-attribute-type="cha"
      :data-attribute-score="cha"
    >
      {{ formatModifier(cha) }}
    </StatBox>
  </div>
</template>
