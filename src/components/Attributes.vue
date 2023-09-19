<script setup lang="ts">
import Statistic from './Statistic.vue'
import { SignedNumber } from '@/utils/utilities'
const { actor } = defineProps(['actor'])
</script>
<template>
  <div>
    <Statistic heading="Str">
      {{ SignedNumber.format(actor.system.abilities.str.base) }}
    </Statistic>
    <Statistic heading="Dex">
      {{ SignedNumber.format(actor.system.abilities.dex.base) }}
    </Statistic>
    <Statistic heading="Con">
      {{ SignedNumber.format(actor.system.abilities.con.base) }}
    </Statistic>
    <Statistic heading="Int">
      {{ SignedNumber.format(actor.system.abilities.int.base) }}
    </Statistic>
    <Statistic heading="Wis">
      {{ SignedNumber.format(actor.system.abilities.wis.base) }}
    </Statistic>
    <Statistic heading="Cha">
      {{ SignedNumber.format(actor.system.abilities.cha.base) }}
    </Statistic>
  </div>
</template>
