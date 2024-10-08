<script setup lang="ts">
import type { Ref } from 'vue'
import type { CharacterRef } from '@/components/Character.vue'
import type { Actor, Combatant } from '@/types/pf2e-types'
import { computed, watch, ref, inject } from 'vue'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/24/solid'
import { formatModifier } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import Statistic from '@/components/Statistic.vue'
import { useCombat } from '@/composables/combat'
import { useKeys } from '@/composables/injectKeys'

const actor = inject(useKeys().actorKey)!
const { updateActor, rollCheck } = useApi()

interface SkillDef {
  slug: string
  label: string
  totalModifier: number
}

const initSkills: Ref<SkillDef[]> = computed(() => {
  const skills = Object.values(actor?.value?.system?.skills ?? {})
  skills.unshift(actor.value?.system?.perception)
  return skills
})
const selected = ref(actor.value?.system?.initiative?.statistic)
watch(selected, async (newSkill, oldSkill) => {
  if (actor.value)
    updateActor(actor as CharacterRef<Actor>, {
      system: { initiative: { statistic: newSkill } }
    }).then(() => {
      actor.requestCharacterDetails!()
    })
})

const { activeCombat } = useCombat()
const initiativeReady = computed(() => {
  const inActiveCombat = activeCombat.value?.combatants
    .map((a: Combatant) => a.actorId)
    .includes(actor.value?._id)
  const initiativeValue = activeCombat.value?.combatants.find(
    (a: Combatant) => a.actorId === actor.value?._id
  )?.initiative
  return inActiveCombat && !initiativeValue
})
function doInitiative() {
  if (actor.value) return rollCheck(actor as Ref<Actor>, 'initiative')
}
// parent.initiative = { activeCombat, initiativeReady }
</script>
<template>
  <div class="flex gap-4 border-b px-6 py-4">
    <Statistic
      heading="Initiative"
      :modifiers="actor?.system?.initiative?.modifiers"
      :allowRoll="initiativeReady"
      :rollAction="() => doInitiative()"
    >
      {{
        formatModifier(
          initSkills.find((s: SkillDef) => s?.slug === actor?.system?.initiative.statistic)
            ?.totalModifier ?? 0
        )
      }}
    </Statistic>
    <Listbox v-model="selected" class="w-full">
      <div class="relative mt-1">
        <ListboxButton
          class="relative w-full cursor-default rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
        >
          <span class="block truncate">{{
            initSkills.find((s: SkillDef) => s?.slug === actor?.system?.initiative.statistic)
              ?.label ?? '...'
          }}</span>
          <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon class="h-5 w-5 text-gray-400" aria-hidden="true" />
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
              v-for="skill in initSkills"
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
  </div>
</template>
