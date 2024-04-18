<script setup lang="ts">
// TODO: (feature) allow players to access skill actions that aren't explicitly on sheet
import type { Ref } from 'vue'
import type { Actor, Skill } from '@/types/pf2e-types'

import { SignedNumber, formatModifier, capitalize } from '@/utils/utilities'
import { inject } from 'vue'
import Statistic from './Statistic.vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'
import { formatTimeAgo } from '@vueuse/core'

const { rollCheck } = useApi()
const actor = inject(useKeys().actorKey)!
function doSkillCheck(slug: string) {
  if (actor.value) return rollCheck(actor as Ref<Actor>, 'skill', slug)
}
</script>
<template>
  <div class="py-4 empty:hidden md:flex md:justify-between">
    <div class="flex-1 px-6">
      <dl
        class="empty:hidden border-t first:border-t-0 pt-4 first:p-0"
        v-for="isNonLore in [true, false]"
      >
        <dt class="font-extralight pb-2">{{ isNonLore ? 'Skills' : 'Lore' }}</dt>
        <div class="columns-2">
          <dd
            v-for="skill in Object.values(actor?.system?.skills ?? {}).filter(
              (s: Skill) => !s.lore === isNonLore
            )"
            class="pb-4 text-lg break-inside-avoid leading-4"
          >
            <Statistic
              :heading="skill.label"
              :proficiency="skill.rank"
              :modifiers="skill.modifiers"
              :allowRoll="true"
              :rollAction="() => doSkillCheck(skill.slug)"
            >
              {{ formatModifier(skill.totalModifier) }}
            </Statistic>
          </dd>
        </div>
      </dl>
    </div>
    <div class="border-t px-6 pt-4 md:border-0 md:pt-0 flex-1 md:border-l">
      <div v-for="proficiencyType in ['attacks', 'defenses', 'classDCs']">
        <dl class="empty:hidden pt-4 first:p-0">
          <dt class="font-extralight pb-2">{{ capitalize(proficiencyType) }}</dt>
          <div class="columns-2">
            <dd
              v-for="(prof, key) in actor?.system.proficiencies[proficiencyType]"
              class="pb-4 text-lg break-inside-avoid leading-4 empty:hidden"
            >
              <Statistic
                :heading="prof.label ?? key"
                v-if="prof.rank > 0"
                :proficiency="prof.rank"
                :allowRoll="false"
              >
                {{ proficiencyType === 'classDCs' ? prof.value : formatModifier(prof.value) }}
              </Statistic>
            </dd>
          </div>
        </dl>
      </div>
      <dl
        class="empty:hidden border-t first:border-t-0 pt-4 first:p-0"
        v-if="actor?.system.proficiencies['spellcasting']?.rank"
      >
        <dt class="font-extralight pb-2">Spellcasting</dt>
        <dd class="pb-4 text-lg break-inside-avoid leading-4 empty:hidden">
          <Statistic
            heading="Spell DC"
            :proficiency="actor?.system.proficiencies['spellcasting'].rank"
            :allowRoll="false"
          >
            {{ actor?.system.attributes?.classOrSpellDC?.value }}
          </Statistic>
        </dd>
      </dl>
    </div>
  </div>
</template>
