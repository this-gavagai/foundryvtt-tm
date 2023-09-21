<script setup lang="ts">
import { computed } from 'vue'
import { SignedNumber } from '@/utils/utilities'
// import SkillsRow from '@/components/SkillsRow.vue'

const props = defineProps(['actor'])

interface SkillRow {
  label: String
  proficiency: number
  modifier: String
  lore: Boolean
}

const skillNames = new Map([
  ['acr', 'Acrobatics'],
  ['arc', 'Arcana'],
  ['ath', 'Athletics'],
  ['cra', 'Crafting'],
  ['dec', 'Deception'],
  ['dip', 'Diplomacy'],
  ['itm', 'Intimidation'],
  ['med', 'Medicine'],
  ['nat', 'Nature'],
  ['occ', 'Occultism'],
  ['prf', 'Performance'],
  ['rel', 'Religion'],
  ['soc', 'Society'],
  ['ste', 'Stealth'],
  ['sur', 'Survival'],
  ['thi', 'Thievery']
])
const levels = ['Untrained', 'Trained', 'Expert', 'Master', 'Legendary']

const skills = computed(() => {
  let skills: SkillRow[] = []
  for (const key in props.actor.system?.skills) {
    const skill = props.actor.system.skills[key]
    skills.push({
      label: skill.label ?? skillNames.get(key),
      proficiency: skill.rank,
      modifier:
        skill?.totalModifier !== undefined ? SignedNumber.format(skill.totalModifier) : '??',
      lore: skill.lore ?? false
    })
  }
  props.actor?.items
    ?.filter((i: any) => i.type === 'lore')
    .forEach((item: any) => {
      if (!skills.find((s: any) => s.label === item.name)) {
        skills.push({
          label: item.name,
          proficiency: item.system.proficient.value,
          modifier: '??',
          lore: true
        })
      }
    })
  return skills
})
</script>
<template>
  <div class="px-6 py-4 border-b empty:hidden">
    <ul class="max-w-6xl empty:hidden">
      <li v-for="skill in skills.filter((s) => !s.lore)" class="grid grid-cols-[3fr_2fr_1fr] gap-4">
        <div>{{ skill.label }}</div>
        <div>{{ levels[skill.proficiency] }}</div>
        <div class="text-right">{{ skill.modifier }}</div>
      </li>
      <li v-for="skill in skills.filter((s) => s.lore)" class="grid grid-cols-[3fr_2fr_1fr] gap-4">
        <div>{{ skill.label }}</div>
        <div>{{ levels[skill.proficiency] }}</div>
        <div class="text-right">{{ skill.modifier }}</div>
      </li>
    </ul>
  </div>
</template>
