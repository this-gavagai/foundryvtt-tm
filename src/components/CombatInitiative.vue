<script setup lang="ts">
import type { Combatant } from '@/types/pf2e-types'
import { computed, inject } from 'vue'
import { formatModifier } from '@/utils/utilities'
import StatBox from '@/components/widgets/StatBox.vue'
import { useCombat } from '@/composables/combat'
import { useKeys } from '@/composables/injectKeys'

import DropdownWidget from './widgets/DropdownWidget.vue'

const character = inject(useKeys().characterKey)!
const { _id: currentActorId, skills, perception } = character
const {
  stat: initiativeStat,
  modifiers: initiativeMods,
  totalModifier: initiativeTotalModifier,
  roll: rollInitiative
} = character.initiative

const skillsPlusPerception = computed(() =>
  (perception.value ? [perception.value] : []).concat(skills.value ?? [])
)

const { activeCombat } = useCombat()
const initiativeReady = computed(() => {
  const inActiveCombat = activeCombat.value?.combatants
    .map((a: Combatant) => a.actorId)
    .includes(currentActorId.value)
  const initiativeValue = activeCombat.value?.combatants.find(
    (a: Combatant) => a.actorId === currentActorId.value
  )?.initiative
  return inActiveCombat && !initiativeValue
})
</script>
<template>
  <div class="flex justify-between gap-4 border-b px-6 py-4">
    <DropdownWidget
      :list="
        skillsPlusPerception.map((s) => ({ id: s.slug, name: s.label })) ?? [
          { id: null, name: '...' }
        ]
      "
      :selectedId="initiativeStat ?? ''"
      :changed="
        (newValue) => {
          initiativeStat = newValue
        }
      "
    />
    <StatBox
      heading="Initiative"
      :modifiers="initiativeMods"
      :rollAction="initiativeReady ? rollInitiative : undefined"
    >
      {{ formatModifier(initiativeTotalModifier ?? NaN) }}
    </StatBox>
  </div>
</template>
