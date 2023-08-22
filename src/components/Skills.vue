<script setup lang="ts">
import { useSheet } from '@/stores/sheet'
import { storeToRefs } from 'pinia'

const sheet = useSheet()
const { actor } = storeToRefs(sheet)
</script>
<template>
  <div class="px-6 py-4 border-b">
    <ul class="max-w-6xl">
      <li v-for="skill in actor.system.skills" class="grid grid-cols-[3fr_2fr_1fr] gap-4">
        <div>{{ skill.label }}</div>
        <!-- <div>{{ ['U', 'T', 'E', 'M', 'L'][skill.rank] }}</div> -->
        <div>{{ skill.modifiers.find((s: any) => s.type === 'proficiency').label }}</div>
        <div class="text-right">{{ '+' + skill.totalModifier }}</div>
      </li>
    </ul>
  </div>
</template>
