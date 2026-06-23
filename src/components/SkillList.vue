<script setup lang="ts">
import type { Stat } from '@/composables/character'

import { formatModifier } from '@/utils/formatters'

import StatBox from './widgets/StatBox.vue'
import SheetSection from './widgets/SheetSection.vue'
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
    class="gap-8 py-4 empty:hidden lg:flex lg:justify-between [&_[data-component=StatBox]>div>div]:text-left"
  >
    <div class="flex-1 px-6 lg:pr-2">
      <SheetSection
        class="border-divider break-inside-avoid-column border-t first:border-t-0 first:p-0 empty:hidden 2xl:border-t-0 2xl:pl-2 2xl:first:border-r 2xl:first:pr-6 [&:not(:has(li))]:hidden"
        :section="isNonLore ? 'skills' : 'lore'"
        :title="isNonLore ? $t('skills.skills') : $t('skills.lore')"
        v-for="isNonLore in showLore ? [true, false] : [true]"
        :key="isNonLore ? 'base' : 'lore'"
      >
        <ul data-part="skill-columns" class="xl:columns-2">
          <li
            v-for="skill in skills?.filter((s: Stat) => !s.lore === isNonLore)"
            class="break-inside-avoid pb-4 text-lg leading-4"
            :key="skill.slug"
          >
            <StatBox
              row
              :heading="skill.label"
              :proficiency="skill.rank"
              :modifiers="skill.modifiers"
              :rollAction="skill?.roll"
            >
              {{ formatModifier(skill.totalModifier) }}
            </StatBox>
          </li>
        </ul>
      </SheetSection>
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
        <SheetSection
          :section="proficiencyType"
          :title="$t('proficiencyTypes.' + proficiencyType)"
          class="pt-4 first:p-0 empty:hidden"
        >
          <ul class="columns-[12rem]">
            <li
              v-for="(prof, key) in proficiencies?.filter(
                (p) => p.type === proficiencyType && p?.rank && p.rank > 0 && !p.visible === false
              )"
              class="break-inside-avoid pb-4 text-lg leading-4 empty:hidden"
              :key="key"
            >
              <StatBox row :heading="prof.label ?? prof.slug" :proficiency="prof.rank">
                {{
                  ['classDCs', 'spellcasting'].includes(proficiencyType)
                    ? prof.value
                    : formatModifier(prof.value)
                }}
              </StatBox>
            </li>
          </ul>
        </SheetSection>
      </div>
    </div>
  </div>
</template>
