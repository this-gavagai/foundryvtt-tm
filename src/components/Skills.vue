<script setup lang="ts">
import { makeTraits, capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'
import { inject } from 'vue'
// import SkillsRow from '@/components/SkillsRow.vue'
import { useServer } from '@/utils/server'

import CheckModifiers from '@/components/CheckModifiers.vue'
import SkillsMacros from '@/components/SkillsMacros.vue'

const actor: any = inject('actor')
// const props = defineProps(['actor'])
const infoModal: any = inject('infoModal')
const { socket } = useServer()

const macros: any = {
  deception: [{ name: 'Feint' }],
  intimidation: [{ name: 'Demoralize' }]
}

function skillInfo(skill: any) {
  console.log('Skill: ', skill)
  if (!skill) return
  infoModal.value?.open({
    title: skill.label,
    description: ['Untrained', 'Trained', 'Expert', 'Master', 'Legendary'][skill.rank],
    component: SkillsMacros,
    componentProps: { skill: skill, actor: actor },
    iconPath: skill?.img,
    actionButtons: [
      {
        actionParams: {
          action: 'rollCheck',
          characterId: actor.value._id,
          checkType: 'skill',
          checkSubtype: skill.slug
        },
        actionMethod: (params: {}) => {
          // todo: manage slotId (for prepared) and level (for heighted) as params
          socket.value.emit('module.tablemate', params)
          infoModal.value.close()
        },
        buttonClasses: 'bg-blue-200 hover:bg-blue-300',
        buttonText: 'Roll Check'
      }
    ]
  })
}
</script>
<template>
  <div class="px-6 py-4 border-b empty:hidden">
    <h3 class="underline text-2xl">Skill Actions</h3>
    <ul class="max-w-6xl empty:hidden columns-2">
      <li
        v-for="skill in actor.system?.skills"
        class="flex gap-2 cursor-pointer"
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
        <!-- <div>{{ levels[skill.proficiency] }}</div> -->
        <template v-if="!skill.lore">
          <div>{{ skill.label }}</div>
          <div class="text-right">{{ SignedNumber.format(skill.totalModifier) }}</div>
        </template>
      </li>
    </ul>
    <ul class="max-w-6xl empty:hidden columns-2 pt-2">
      <li
        v-for="skill in actor.system?.skills"
        class="flex gap-2 cursor-pointer"
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
        <!-- <div>{{ levels[skill.proficiency] }}</div> -->
        <template v-if="skill.lore">
          <div>{{ skill.label }}</div>
          <div class="text-right">{{ SignedNumber.format(skill.totalModifier) }}</div>
        </template>
      </li>
    </ul>
  </div>
</template>
