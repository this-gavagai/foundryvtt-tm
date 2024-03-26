<script setup lang="ts">
// TODO: (feature) allow players to access skill actions that aren't explicitly on sheet
import type { Ref } from 'vue'
import type { Actor, Skill } from '@/types/pf2e-types'

import { SignedNumber } from '@/utils/utilities'
import { inject } from 'vue'
import Statistic from './Statistic.vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

// import Macro from '@/components/Macro.vue'
// import CheckModifiers from '@/components/CheckModifiers.vue'
// import SkillsMacros from '@/components/SkillsMacros.vue'

const { rollCheck } = useApi()
const actor = inject(useKeys().actorKey)!
function doSkillCheck(slug: string) {
  if (actor.value) return rollCheck(actor as Ref<Actor>, 'skill', slug)
}
</script>
<template>
  <div class="px-6 py-4 empty:hidden">
    <div>
      <ul
        class="empty:hidden columns-2 border-t first:border-t-0 pt-4 first:p-0"
        v-for="isNonLore in [true, false]"
      >
        <li
          v-for="skill in Object.values(actor?.system?.skills ?? {}).filter(
            (s: Skill) => !s.lore === isNonLore
          )"
          class="mb-4 text-lg break-inside-avoid leading-4"
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
  </div>
</template>
