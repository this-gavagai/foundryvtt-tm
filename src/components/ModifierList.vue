<script setup lang="ts">
import { SignedNumber } from '@/utils/utilities'
import type { Modifier } from '@/composables/character'

defineProps<{
  modifiers: Modifier[] | undefined
}>()
</script>
<template>
  <ul>
    <li
      v-for="mod in (modifiers ?? []).filter((m: Modifier) => m.enabled || !m.hideIfDisabled)"
      data-part="modifier"
      :data-disabled="!mod.enabled || undefined"
      class="flex gap-2"
      :class="{ 'text-gray-300': !mod.enabled }"
      :key="'mod_' + mod.slug"
    >
      <div class="w-8 text-right">{{ SignedNumber.format(mod.modifier ?? 0) }}</div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
    </li>
  </ul>
</template>
