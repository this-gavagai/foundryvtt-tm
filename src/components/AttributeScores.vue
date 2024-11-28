<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { attributes } from '@/utils/constants'
import { useKeys } from '@/composables/injectKeys'

const { rollCheck } = useApi()
const actor = inject(useKeys().actorKey)!
function doStatCheck(type: string, subtype: string) {
  if (actor.value) return rollCheck(actor as Ref<Actor>, type, subtype)
}
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox v-for="attr in attributes" :heading="attr.heading" :key="'attr_' + attr">
      {{ formatModifier(actor?.system?.abilities?.[attr.abbr]?.mod) }}
    </StatBox>
  </div>
  <div class="flex justify-between border-b px-6 py-4">
    <StatBox
      heading="Fort"
      :proficiency="actor?.system?.saves?.fortitude?.rank"
      :modifiers="actor?.system?.saves?.fortitude?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('save', 'fortitude')"
    >
      {{ formatModifier(actor?.system?.saves?.fortitude?.totalModifier) }}
    </StatBox>
    <StatBox
      heading="Refl"
      :proficiency="actor?.system?.saves?.reflex?.rank"
      :modifiers="actor?.system?.saves?.reflex?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('save', 'reflex')"
    >
      {{ formatModifier(actor?.system?.saves?.reflex?.totalModifier) }}
    </StatBox>
    <StatBox
      heading="Will"
      :proficiency="actor?.system?.saves?.will?.rank"
      :modifiers="actor?.system?.saves?.will?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('save', 'will')"
    >
      {{ formatModifier(actor?.system?.saves?.will?.totalModifier) }}
    </StatBox>
    <div class="border border-gray-200"></div>
    <StatBox
      heading="Perception"
      :proficiency="actor?.system?.perception?.rank"
      :modifiers="actor?.system?.perception?.modifiers"
      :allowRoll="true"
      :rollAction="() => doStatCheck('perception', '')"
    >
      {{ formatModifier(actor?.system?.perception?.value) }}
    </StatBox>
  </div>
</template>
@/composables@/types/pf2e-types
