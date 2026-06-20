<script setup lang="ts">
import type { Stat } from '@/composables/character'

import { formatModifier } from '@/utils/formatters'

import StatBox from './widgets/StatBox.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { skills, proficiencies } = character

withDefaults(
  defineProps<{
    showLore?: boolean
    showProficiencies?: boolean
  }>(),
  {
    showLore: true,
    showProficiencies: true
  }
)
</script>
<template>
  <div
    data-component="SkillList"
    class="py-4 empty:hidden lg:flex lg:justify-between [&_[data-component=StatBox]>div>div]:text-left"
  >
    <div class="flex-1 px-6 lg:pr-2">
      <section
        class="border-divider break-inside-avoid-column border-t first:border-t-0 first:p-0 empty:hidden 2xl:border-t-0 2xl:pl-2 2xl:first:border-r 2xl:first:pr-6 [&:not(:has(li))]:hidden"
        :data-section="isNonLore ? 'skills' : 'lore'"
        v-for="isNonLore in showLore ? [true, false] : [true]"
        :key="isNonLore ? 'base' : 'lore'"
      >
        <h3 class="pb-2 text-lg underline">
          {{ isNonLore ? $t('skills.skills') : $t('skills.lore') }}
        </h3>
        <ul data-part="skill-columns" class="columns-2">
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
      v-if="showProficiencies"
      class="border-divider flex-1 border-t px-6 pt-4 lg:border-0 lg:pt-0 lg:pl-2 [&:not(:has(li))]:hidden"
    >
      <div
        v-for="proficiencyType in ['attacks', 'defenses', 'classDCs', 'spellcasting']"
        :key="proficiencyType"
        class="[&:not(:has(li))]:hidden"
      >
        <section :data-section="proficiencyType" class="pt-4 first:p-0 empty:hidden">
          <h3 class="pb-2 text-lg underline">{{ $t('proficiencyTypes.' + proficiencyType) }}</h3>
          <ul class="columns-[12rem]">
            <li
              v-for="(prof, key) in proficiencies?.filter(
                (p) => p.type === proficiencyType && p?.rank && p.rank > 0 && !p.visible === false
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
