<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { inject } from 'vue'
import Statistic from './Statistic.vue'
import { SignedNumber, formatModifier } from '@/utils/utilities'
import { rollCheck } from '@/composables/api'
import { attributes } from '@/utils/constants'

const actor: Ref<Actor> = inject('actor')!
function doStatCheck(type: string, subtype: string) {
  return rollCheck(actor, type, subtype)
}
</script>
<template>
  <div class="px-6 py-4 flex justify-between border-b">
    <Statistic v-for="attr in attributes" :heading="attr.heading">
      {{ formatModifier(actor?.system?.abilities?.[attr.abbr]?.mod) }}
    </Statistic>
  </div>
  <div class="px-6 py-4 flex justify-between border-b">
    <Statistic
      heading="Fortitude"
      :proficiency="actor?.system?.saves.fortitude?.rank"
      :modifiers="actor?.system?.saves.fortitude?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('save', 'fortitude')"
    >
      {{ formatModifier(actor?.system?.saves.fortitude?.totalModifier) }}
    </Statistic>
    <Statistic
      heading="Reflex"
      :proficiency="actor?.system?.saves.reflex?.rank"
      :modifiers="actor?.system?.saves.reflex?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('save', 'reflex')"
    >
      {{ formatModifier(actor?.system?.saves.reflex?.totalModifier) }}
    </Statistic>
    <Statistic
      heading="Will"
      :proficiency="actor?.system?.saves.will?.rank"
      :modifiers="actor?.system?.saves.will?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('save', 'will')"
    >
      {{ formatModifier(actor?.system?.saves.will?.totalModifier) }}
    </Statistic>
    <div class="border border-gray-200"></div>
    <Statistic
      heading="Perception"
      :proficiency="actor?.system?.perception?.rank"
      :modifiers="actor?.system?.perception?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('perception', '')"
    >
      {{ formatModifier(actor?.system?.perception?.value) }}
    </Statistic>
  </div>
</template>
