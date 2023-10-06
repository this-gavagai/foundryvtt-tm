<script setup lang="ts">
import { SignedNumber } from '@/utils/utilities'

const props = defineProps(['skill'])
console.log(props)
</script>
<template>
  <div v-for="modType in new Set(props.skill.modifiers.map((m: any) => m.type))">
    <div class="text-xs uppercase pt-2">{{ modType }}</div>
    <div
      v-for="mod in props.skill.modifiers.filter((m: any) => m.type === modType)"
      :class="[mod.enabled && !mod.predicate.length ? 'text-black' : 'text-gray-300']"
    >
      {{ mod.label }} {{ SignedNumber.format(mod.modifier) }}
    </div>
  </div>
</template>
