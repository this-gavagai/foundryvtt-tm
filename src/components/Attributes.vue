<script setup lang="ts">
import { inject } from 'vue'
import { type Actor } from '@/utils/pf2e-types'
import Statistic from './Statistic.vue'
import { SignedNumber } from '@/utils/utilities'
import { useAttributeScores, type modSet } from '@/utils/characterData'
const actor: any = inject('actor')

const attributes = [
  { heading: 'Str', abbr: 'str' },
  { heading: 'Dex', abbr: 'dex' },
  { heading: 'Con', abbr: 'con' },
  { heading: 'Int', abbr: 'int' },
  { heading: 'Wis', abbr: 'wis' },
  { heading: 'Cha', abbr: 'cha' }
]

// TODO: this useAttributeScores thing is really hard to do right. Worth doing even? Not sure.
const attrMods = useAttributeScores((): Actor => actor)
</script>
<template>
  <div>
    <Statistic v-for="attr in attributes" :heading="attr.heading">
      {{
        typeof actor.system?.abilities?.[attr.abbr]?.base === 'number'
          ? SignedNumber.format(actor.system?.abilities?.[attr.abbr]?.base)
          : '??'
      }}
    </Statistic>
  </div>
</template>
