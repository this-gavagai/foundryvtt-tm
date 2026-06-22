<script setup lang="ts">
import type { CombatantPF2e } from '@7h3laughingman/pf2e-types'
import { computed } from 'vue'
import { formatModifier } from '@/utils/formatters'
import StatBox from '@/components/widgets/StatBox.vue'
import { storeToRefs } from 'pinia'
import { useCombatStore } from '@/stores/combat'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'

import DropdownWidget from './widgets/DropdownWidget.vue'

const character = useInjectedCharacter()
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

const { activeCombat } = storeToRefs(useCombatStore())
const { isListening } = storeToRefs(useListenersStore())
const initiativeReady = computed(() => {
  const inActiveCombat = activeCombat.value?.combatants.some(
    (a: CombatantPF2e) => a.actorId === currentActorId.value
  )
  const initiativeValue = activeCombat.value?.combatants.find(
    (a: CombatantPF2e) => a.actorId === currentActorId.value
  )?.initiative
  return inActiveCombat && !initiativeValue
})
</script>
<template>
  <div data-component="CombatInitiative">
    <div data-part="heading" class="pb-1 text-[0.8rem] font-normal uppercase">
      {{ $t('combat.initiative') }}
    </div>
    <div class="flex gap-4">
      <DropdownWidget
        class="grow"
        :list="
          skillsPlusPerception.map((s) => ({ id: s.slug, name: s.label })) ?? [
            { id: null, name: '...' }
          ]
        "
        :selectedId="initiativeStat ?? ''"
        :disabled="!isListening"
        :changed="(newValue) => (initiativeStat = newValue)"
      />
      <div
        data-component="InitiativeBox"
        class="flex items-center px-2 [&_[data-component=StatBox]>div>div:first-child]:hidden"
      >
        <StatBox
          :modalHeading="$t('combat.initiative')"
          :modifiers="initiativeMods"
          :rollAction="initiativeReady ? rollInitiative : undefined"
        >
          {{ formatModifier(initiativeTotalModifier ?? NaN) }}
        </StatBox>
      </div>
    </div>
  </div>
</template>
