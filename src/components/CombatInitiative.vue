<script setup lang="ts">
import type { Combatant } from '@/types/pf2e-types'
import type { Stat } from '@/composables/character'
import { computed, inject } from 'vue'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/24/solid'
import { formatModifier } from '@/utils/utilities'
import StatBox from '@/components/StatBox.vue'
import { useCombat } from '@/composables/combat'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { _id: currentActorId, skills, perception } = character
const {
  stat: initiativeStat,
  modifiers: initiativeMods,
  totalModifier: initiativeTotalModifier,
  roll: rollInitiative
} = character.initiative

// const initSkills: ComputedRef<Stat[]> = computed(() => {
//   const skillList = skills.value ?? []
//   if (perception.value) skillList.unshift(perception.value)
//   return skillList
// })
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
    <Listbox v-model="initiativeStat" class="w-full">
      <div class="relative mt-1">
        <ListboxButton
          class="relative w-full cursor-pointer rounded-lg border border-gray-400 bg-white py-2 pl-3 pr-10 text-left focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
        >
          <span class="block truncate">{{
            skillsPlusPerception?.find((s: Stat) => s?.slug === initiativeStat)?.label ?? '...'
          }}</span>
          <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon class="h-5 w-5 text-gray-600" aria-hidden="true" />
          </span>
        </ListboxButton>
        <transition
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <ListboxOptions
            class="z-100000 absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
          >
            <ListboxOption
              v-slot="{ active, selected }"
              v-for="skill in skillsPlusPerception"
              :key="skill.slug"
              :value="skill.slug"
              as="template"
            >
              <li
                :class="[
                  active ? 'bg-amber-100 text-amber-900' : 'text-gray-900',
                  'relative cursor-default select-none py-2 pl-10 pr-4'
                ]"
              >
                <span :class="[selected ? 'font-medium' : 'font-normal', 'block truncate']">
                  {{ skill.label }} ({{ formatModifier(skill.totalModifier) }})
                </span>
                <span
                  v-if="selected"
                  class="absolute inset-y-0 left-0 flex items-center pl-3 text-amber-600"
                >
                  <CheckIcon class="h-5 w-5" aria-hidden="true" />
                </span>
              </li>
            </ListboxOption>
          </ListboxOptions>
        </transition>
      </div>
    </Listbox>
    <StatBox
      heading="Initiative"
      :modifiers="initiativeMods"
      :rollAction="initiativeReady ? () => rollInitiative() : null"
    >
      {{ formatModifier(initiativeTotalModifier ?? NaN) }}
    </StatBox>
  </div>
</template>
