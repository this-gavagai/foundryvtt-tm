<script setup lang="ts">
import type { Actor, Skill } from '@/utils/pf2e-types'

import { SignedNumber } from '@/utils/utilities'
import { inject } from 'vue'
import Statistic from './Statistic.vue'

// import Macro from '@/components/Macro.vue'
// import CheckModifiers from '@/components/CheckModifiers.vue'
// import SkillsMacros from '@/components/SkillsMacros.vue'

const actor: Actor = inject('actor')!
// const infoModal: any = inject('infoModal')
// const { socket } = useServer()
// const macros: any = {
//   deception: [{ name: 'Feint' }],
//   intimidation: [{ name: 'Demoralize' }]
// }
// function skillInfo(skill: any) {
//   console.log('Skill: ', skill)
//   if (!skill) return
//   infoModal.value?.open({
//     title: skill.label,
//     description: ['Untrained', 'Trained', 'Expert', 'Master', 'Legendary'][skill.rank],
//     // component: SkillsMacros,
//     // componentProps: { skill: skill, actor: actor },
//     iconPath: skill?.img
//     // actionButtons: [
//     //   {
//     //     actionParams: {
//     //       action: 'rollCheck',
//     //       characterId: actor.value._id,
//     //       checkType: 'skill',
//     //       checkSubtype: skill.slug
//     //     },
//     //     actionMethod: (params: {}) => {
//     //       socket.value.emit('module.tablemate', params)
//     //       infoModal.value.close()
//     //     },
//     //     buttonClasses: 'bg-blue-200 hover:bg-blue-300',
//     //     buttonText: 'Roll Check'
//     //   }
//     // ]
//   })
// }
</script>
<template>
  <div class="px-6 py-4 border-b empty:hidden">
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
        class="empty:hidden columns-2 border-t first:border-t-0 pt-2"
        v-for="isNonLore in [true, false]"
      >
        <li
          v-for="skill in Object.values(actor?.system?.skills ?? {}).filter(
            (s: Skill) => !s.lore === isNonLore
          )"
          class="cursor-pointer mb-2 text-lg break-inside-avoid"
        >
          <Statistic :heading="skill.label" :proficiency="skill.rank">
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
