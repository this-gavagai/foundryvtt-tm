<script setup lang="ts">
import { inject } from 'vue'
import StatBox from './StatBox.vue'
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
    <StatBox heading="Dex" data-attribute-type="str" :data-attribute-score="str">
      {{ formatModifier(dex) }}
    </StatBox>
    <StatBox heading="Con" data-attribute-type="str" :data-attribute-score="str">
      {{ formatModifier(con) }}
    </StatBox>
    <StatBox heading="Int" data-attribute-type="str" :data-attribute-score="str">
      {{ formatModifier(int) }}
    </StatBox>
    <StatBox heading="Wis" data-attribute-type="str" :data-attribute-score="str">
      {{ formatModifier(wis) }}
    </StatBox>
    <StatBox heading="Cha" data-attribute-type="str" :data-attribute-score="str">
      {{ formatModifier(cha) }}
    </StatBox>
  </div>
</template>
