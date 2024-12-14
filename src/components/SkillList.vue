<script setup lang="ts">
// TODO (feature++): allow players to access skill actions that aren't explicitly on sheet
import type { Stat } from '@/composables/character'

import { formatModifier } from '@/utils/utilities'
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { skills, proficiencies } = character
</script>
<template>
  <div class="py-4 empty:hidden lg:flex lg:justify-between">
    <div class="flex-1 px-6">
      <dl
        class="border-t pt-4 first:border-t-0 first:p-0 empty:hidden [&:not(:has(dd))]:hidden"
        v-for="isNonLore in [true, false]"
        :key="isNonLore ? 'norm' : 'lore'"
      >
        <dt class="pb-2 text-lg underline">{{ isNonLore ? 'Skills' : 'Lore' }}</dt>
        <div class="columns-2">
          <dd
            v-for="skill in skills?.filter((s: Stat) => !s.lore === isNonLore)"
            class="break-inside-avoid pb-4 text-lg leading-4"
            :key="skill.slug"
          >
            <StatBox
              :heading="skill.label"
              :proficiency="skill.rank"
              :modifiers="skill.modifiers"
              :rollAction="() => (skill.roll ? skill?.roll() : null)"
            >
              {{ formatModifier(skill.totalModifier) }}
            </StatBox>
          </dd>
        </div>
      </dl>
    </div>
    <div class="flex-1 border-t px-6 pt-4 lg:border-0 lg:border-l lg:pt-0">
      <div
        v-for="proficiencyType in ['attacks', 'defenses', 'classDCs', 'spellcasting']"
        :key="proficiencyType"
        class="[&:not(:has(dd))]:hidden"
      >
        <dl class="pt-4 first:p-0 empty:hidden">
          <dt class="pb-2 text-lg capitalize underline">{{ proficiencyType }}</dt>
          <div class="columns-2">
            <dd
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
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </div>
</template>
