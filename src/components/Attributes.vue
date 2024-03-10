<script setup lang="ts">
import { inject } from 'vue'
import { type Actor } from '@/utils/pf2e-types'
import Statistic from './Statistic.vue'
import { SignedNumber } from '@/utils/utilities'
const actor: any = inject('actor')

const attributes = [
  { heading: 'Str', abbr: 'str' },
  { heading: 'Dex', abbr: 'dex' },
  { heading: 'Con', abbr: 'con' },
  { heading: 'Int', abbr: 'int' },
  { heading: 'Wis', abbr: 'wis' },
  { heading: 'Cha', abbr: 'cha' }
]
</script>
<template>
  <div class="px-6 py-4 flex justify-between border-b">
    <Statistic v-for="attr in attributes" :heading="attr.heading">
      {{
        typeof actor.system?.abilities?.[attr.abbr]?.mod === 'number'
          ? SignedNumber.format(actor.system?.abilities?.[attr.abbr]?.mod)
          : '??'
      }}
    </Statistic>
  </div>
  <div class="px-6 py-4 flex justify-between border-b">
    <Statistic heading="AC">
      {{ actor.system?.attributes?.ac?.value }}
    </Statistic>
    <div class="border border-gray-200"></div>
    <Statistic v-for="save in actor.system?.saves" :heading="save.label" :proficiency="save.rank">
      {{ SignedNumber.format(save.totalModifier) }}
    </Statistic>
    <div class="border border-gray-200"></div>
    <Statistic heading="Perception" :proficiency="actor.system?.perception?.rank">
      {{ SignedNumber.format(actor.system?.perception?.value) }}
    </Statistic>
  </div>
</template>
