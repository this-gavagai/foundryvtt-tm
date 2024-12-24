<script setup lang="ts">
import { inject } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { str, dex, con, int, wis, cha } = character.attributes
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox heading="Str" data-attribute-type="str" :data-attribute-score="str">
      {{ formatModifier(str) }}
    </StatBox>
    <StatBox heading="Dex" data-attribute-type="dex" :data-attribute-score="dex">
      {{ formatModifier(dex) }}
    </StatBox>
    <StatBox heading="Con" data-attribute-type="con" :data-attribute-score="con">
      {{ formatModifier(con) }}
    </StatBox>
    <StatBox heading="Int" data-attribute-type="int" :data-attribute-score="int">
      {{ formatModifier(int) }}
    </StatBox>
    <StatBox heading="Wis" data-attribute-type="wis" :data-attribute-score="wis">
      {{ formatModifier(wis) }}
    </StatBox>
    <StatBox heading="Cha" data-attribute-type="cha" :data-attribute-score="cha">
      {{ formatModifier(cha) }}
    </StatBox>
  </div>
</template>
