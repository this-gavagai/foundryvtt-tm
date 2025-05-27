<script setup lang="ts">
import type { Stat } from '@/composables/character'

import { formatModifier } from '@/utils/utilities'
import { inject } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { skills, proficiencies } = character
</script>
<template>
  <div class="py-4 empty:hidden lg:flex lg:justify-between">
    <div class="flex-1 px-6 2xl:columns-2">
      <section
        class="border-divider break-inside-avoid-column border-t first:border-t-0 first:p-0 empty:hidden 2xl:border-t-0 2xl:pl-2 2xl:first:border-r 2xl:first:pr-6 [&:not(:has(li))]:hidden"
        v-for="isNonLore in [true, false]"
        :key="isNonLore ? 'base' : 'lore'"
      >
        <h3 class="pb-2 text-lg underline">{{ isNonLore ? 'Skills' : 'Lore' }}</h3>
        <ul class="columns-2">
          <li
            v-for="skill in skills?.filter((s: Stat) => !s.lore === isNonLore)"
            class="break-inside-avoid pb-4 text-lg leading-4"
            :key="skill.slug"
          >
            <StatBox
              :heading="skill.label"
              :proficiency="skill.rank"
              :modifiers="skill.modifiers"
              :rollAction="skill?.roll"
            >
              {{ formatModifier(skill.totalModifier) }}
            </StatBox>
          </li>
        </ul>
      </section>
    </div>
    <div
      class="border-divider flex-1 border-t px-6 pt-4 lg:border-0 lg:border-l lg:pt-0 [&:not(:has(li))]:hidden"
    >
      <div
        v-for="proficiencyType in ['attacks', 'defenses', 'classDCs', 'spellcasting']"
        :key="proficiencyType"
        class="[&:not(:has(li))]:hidden"
      >
        <section class="pt-4 first:p-0 empty:hidden">
          <h3 class="pb-2 text-lg capitalize underline">{{ proficiencyType }}</h3>
          <ul class="columns-2">
            <li
              v-for="(prof, key) in proficiencies?.filter(
                (p) => p.type === proficiencyType && p?.rank && p.rank > 0
              )"
              class="break-inside-avoid pb-4 text-lg leading-4 empty:hidden"
              :key="key"
            >
              <StatBox :heading="prof.label ?? prof.slug" :proficiency="prof.rank">
                {{
                  ['classDCs', 'spellcasting'].includes(proficiencyType)
                    ? prof.value
                    : formatModifier(prof.value)
                }}
              </StatBox>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
