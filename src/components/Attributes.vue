<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSheet } from '@/stores/sheet'

import Statistic from './Statistic.vue'

const sheet: any = useSheet()
const { actor } = storeToRefs(sheet)
</script>
<template>
  <div>
    <Statistic heading="Str">
      {{ actor.system.abilities.str.base >= 0 ? '+' : '' }}{{ actor.system.abilities.str.base }}
    </Statistic>
    <Statistic heading="Dex">
      {{ actor.system.abilities.dex.base >= 0 ? '+' : '' }}{{ actor.system.abilities.dex.base }}
    </Statistic>
    <Statistic heading="Con">
      {{ actor.system.abilities.con.base >= 0 ? '+' : '' }}{{ actor.system.abilities.con.base }}
    </Statistic>
    <Statistic heading="Int">
      {{ actor.system.abilities.int.base >= 0 ? '+' : '' }}{{ actor.system.abilities.int.base }}
    </Statistic>
    <Statistic heading="Wis">
      {{ actor.system.abilities.wis.base >= 0 ? '+' : '' }}{{ actor.system.abilities.wis.base }}
    </Statistic>
    <Statistic heading="Cha">
      {{ actor.system.abilities.cha.base >= 0 ? '+' : '' }}{{ actor.system.abilities.cha.base }}
    </Statistic>
  </div>
</template>
