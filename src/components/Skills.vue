<script setup lang="ts">
// TODO: (feature) allow players to access skill actions that aren't on here
import type { Ref } from 'vue'
import type { Actor, Skill } from '@/types/pf2e-types'

import { SignedNumber } from '@/utils/utilities'
import { inject } from 'vue'
import Statistic from './Statistic.vue'
import { useApi } from '@/composables/api'

// import Macro from '@/components/Macro.vue'
// import CheckModifiers from '@/components/CheckModifiers.vue'
// import SkillsMacros from '@/components/SkillsMacros.vue'

const { rollCheck } = useApi()
const actor: Ref<Actor> = inject('actor')!
// const mods = [{ label: 'test', modifier: 3 }]
function doSkillCheck(slug: string) {
  return rollCheck(actor, 'skill', slug)
}
</script>
<template>
  <div class="px-6 py-4 empty:hidden">
    <!-- <Macro compendium="xdy-pf2e-workbench.asymonous-benefactor-macros" macro="i6YqLOlgMY6oqQ9t"
      >Recall Knowledge</Macro
    > -->
    <!-- <ul class="empty:hidden columns-2">
      <li v-for="skill in actor.system?.skills" class="cursor-pointer mb-4 text-lg">
        <Statistic :heading="skill.label" :proficiency="skill.rank" v-if="!skill.lore">
          {{ SignedNumber.format(skill.totalModifier) }}
        </Statistic>
      </li>
    </ul> -->
    <div>
      <ul
        class="empty:hidden columns-2 border-t first:border-t-0 pt-4 first:p-0"
        v-for="isNonLore in [true, false]"
      >
        <li
          v-for="skill in Object.values(actor?.system?.skills ?? {}).filter(
            (s: Skill) => !s.lore === isNonLore
          )"
          class="cursor-pointer mb-4 text-lg break-inside-avoid leading-4"
        >
          <Statistic
            :heading="skill.label"
            :proficiency="skill.rank"
            :modifiers="skill.modifiers"
            :allowRoll="true"
            :rollAction="() => doSkillCheck(skill.slug)"
          >
            {{ SignedNumber.format(skill.totalModifier) }}
          </Statistic>
        </li>
      </ul>
    </div>
    <!-- <div
          class="flex gap-2"
          :class="[
            skill.rank === 1
              ? 'text-blue-800'
              : skill.rank === 2
              ? 'text-purple-800'
              : skill.rank === 3
              ? 'text-yellow-800'
              : skill.rank === 4
              ? 'text-red-800'
              : 'text-black'
          ]"
          @click="skillInfo(skill)"
        >
          <div>{{ skill.label }}</div>
          <div class="text-right">{{ SignedNumber.format(skill.totalModifier) }}</div>
        </div> -->
    <!-- <div class="flex flex-wrap gap-2">
          <Macro
            v-for="macro in skillMacros
              .filter((m: any) => m.skill === skill.slug)
              .filter((m: any) => !m.trained || skill.rank)"
            :compendium="macro.compendium"
            :macro="macro.macro"
            >{{ macro.name }}</Macro
          >
        </div> -->
  </div>
</template>
@/composables/api@/composables@/types/pf2e-types
