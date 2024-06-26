<script setup lang="ts">
// TODO: (feature+) allow players to access skill actions that aren't explicitly on sheet
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
  <div class="py-4 empty:hidden lg:flex lg:justify-between">
    <div class="flex-1 px-6">
      <dl
        class="border-t pt-4 first:border-t-0 first:p-0 empty:hidden"
        v-for="isNonLore in [true, false]"
      >
        <dt class="pb-2 text-lg underline">{{ isNonLore ? 'Skills' : 'Lore' }}</dt>
        <div class="columns-2">
          <dd
            v-for="skill in Object.values(actor?.system?.skills ?? {}).filter(
              (s: Skill) => !s.lore === isNonLore
            )"
            class="break-inside-avoid pb-4 text-lg leading-4"
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
    <div class="flex-1 border-t px-6 pt-4 lg:border-0 lg:border-l lg:pt-0">
      <div v-for="proficiencyType in ['attacks', 'defenses', 'classDCs']">
        <dl class="pt-4 first:p-0 empty:hidden">
          <dt class="pb-2 text-lg underline">{{ capitalize(proficiencyType) }}</dt>
          <div class="columns-2">
            <dd
              v-for="(prof, key) in actor?.system?.proficiencies?.[proficiencyType]"
              class="break-inside-avoid pb-4 text-lg leading-4 empty:hidden"
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
        class="border-t pt-4 first:border-t-0 first:p-0 empty:hidden"
        v-if="actor?.system?.proficiencies?.['spellcasting']?.rank"
      >
        <dt class="pb-2 text-lg underline">Spellcasting</dt>
        <dd class="break-inside-avoid pb-4 text-lg leading-4 empty:hidden">
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
