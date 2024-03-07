<script setup lang="ts">
import { computed, watch, ref, inject } from 'vue'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/24/solid'
import { mergeDeep, SignedNumber } from '@/utils/utilities'
import { useServer } from '@/utils/server'

const { socket } = useServer()
const props = defineProps(['actor'])
const actor: any = inject('actor')

const initSkills: any = computed(() => {
  const skills = Object.values(actor.value.system?.skills ?? {})
  skills.unshift(actor.value.system?.perception)
  return skills
})
const selected = ref(actor.value?.system?.initiative?.statistic)
watch(selected, async (newSkill, oldSkill) => {
  console.log(newSkill)
  socket.value.emit(
    'modifyDocument',
    {
      action: 'update',
      type: 'Actor',
      options: { diff: true, render: true },
      updates: [
        {
          _id: actor.value._id,
          system: {
            initiative: {
              statistic: newSkill
            }
          }
        }
      ]
    },
    (x: any) => {
      console.log(x)
      x.result.forEach((change: any) => {
        mergeDeep(actor?.value, change)
      })
    }
  )
})
function rollInitiative() {
  socket.value.emit('module.tablemate', {
    action: 'rollInitiative',
    characterId: actor.value._id
  })
}
</script>
<template>
  <div class="relative px-6 py-4 border-b">
    <div class="uppercase text-xs">Initiative</div>
    <Listbox v-model="selected">
      <div class="relative mt-1">
        <div class="flex">
          <ListboxButton
            class="relative w-full cursor-default rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left shadow-md focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
          >
            <span class="block truncate">{{
              initSkills.find((s: any) => s?.slug === actor.system?.initiative.statistic)?.label
            }}</span>
            <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon class="h-5 w-5 text-gray-400" aria-hidden="true" />
            </span>
          </ListboxButton>
          <div class="p-2 w-8">
            {{
              SignedNumber.format(
                initSkills.find((s: any) => s?.slug === actor.system?.initiative.statistic)
                  ?.totalModifier ?? 0
              )
            }}
          </div>
          <!-- <div class="pl-2 pt-1 w-12 cursor-pointer" @click="rollInitiative()">
            <img src="@/assets/icons/dice-twenty-faces-twenty.svg" />
          </div> -->
        </div>

        <transition
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <ListboxOptions
            class="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
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
                  {{ skill.label }} ({{ SignedNumber.format(skill.totalModifier) }})
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
