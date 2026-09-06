<script setup lang="ts">
import type { CombatantPF2e } from '@7h3laughingman/pf2e-types'
import { computed } from 'vue'
import { formatModifier } from '@/utils/formatters'
import StatBox from '@/components/widgets/StatBox.vue'
import { storeToRefs } from 'pinia'
import { useCombatStore } from '@/stores/combat'
import { useInjectedActor } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'
import { useDerivedStale } from '@/composables/useDerivedStale'
import { useProvisionalFigure } from '@/composables/useProvisionalFigure'

import DropdownWidget from './widgets/DropdownWidget.vue'

const actor = useInjectedActor()
const { _id: currentActorId, skills, perception, initiative } = actor
// `initiative` is optional on the shared actor surface (familiars don't roll
// it), so the statistic picker and roll button read through it.
const initiativeStat = computed({
  get: () => initiative?.stat.value,
  set: (newValue) => {
    if (initiative) initiative.stat.value = newValue
  }
})
const initiativeMods = computed(() => initiative?.modifiers.value)
const initiativeTotalModifier = computed(() => initiative?.totalModifier.value)
const rollInitiative = initiative?.roll

// Initiative's total is prepared data, so it is absent without a GM and the
// engine derives it from whichever statistic rolls it. Same doubt, same marks
// as AC and the saves.
const derivedStale = useDerivedStale(currentActorId)
const { attrs } = useProvisionalFigure(
  derivedStale,
  computed(() => initiative?.provisional?.value),
  computed(() => initiative?.caveat?.value)
)

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
          <span v-bind="attrs">{{ formatModifier(initiativeTotalModifier ?? NaN) }}</span>
        </StatBox>
      </div>
    </div>
  </div>
</template>
