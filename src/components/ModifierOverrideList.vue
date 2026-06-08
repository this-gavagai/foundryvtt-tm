<script setup lang="ts">
import { computed } from 'vue'
import { SignedNumber } from '@/utils/formatters'
import type { Modifier } from '@/composables/character'

const props = defineProps<{
  modifiers?: Modifier[]
  toggleable?: boolean
  showAll?: boolean
  showDamageType?: boolean
  effectiveEnabled: (mod: Modifier) => boolean
  isManuallyActivated: (mod: Modifier) => boolean
  isManuallyDeactivated: (mod: Modifier) => boolean
  isStackingLoser: (mod: Modifier) => boolean
  onToggle?: (mod: Modifier) => unknown
}>()

const visibleModifiers = computed(() =>
  props.showAll
    ? (props.modifiers ?? [])
    : (props.modifiers ?? []).filter(
        (mod) =>
          mod.enabled ||
          !mod.hideIfDisabled ||
          props.isManuallyActivated(mod) ||
          props.isManuallyDeactivated(mod)
      )
)

const gridClass = computed(() =>
  props.showDamageType ? 'grid-cols-[2.5rem_6rem_1fr_auto]' : 'grid-cols-[2.5rem_6rem_1fr]'
)

function canToggle(mod: Modifier) {
  return props.toggleable && mod.modifier !== undefined
}

function toggle(mod: Modifier) {
  if (canToggle(mod)) props.onToggle?.(mod)
}
</script>

<template>
  <ul>
    <li
      v-for="mod in visibleModifiers"
      data-part="modifier"
      :data-disabled="
        (!effectiveEnabled(mod) && !isManuallyActivated(mod) && !isManuallyDeactivated(mod)) ||
        undefined
      "
      :data-manual-on="isManuallyActivated(mod) || undefined"
      :data-manual-off="isManuallyDeactivated(mod) || undefined"
      :data-stacking-loser="isStackingLoser(mod) || undefined"
      :title="
        isStackingLoser(mod)
          ? 'Outranked by a higher same-type modifier; will not contribute to the roll'
          : undefined
      "
      class="grid items-center gap-2 rounded-sm border border-transparent px-1 py-0.5"
      :class="[
        gridClass,
        {
          'cursor-pointer': canToggle(mod),
          'text-gray-300': !effectiveEnabled(mod) && !isManuallyDeactivated(mod),
          'border-green-500 bg-green-100/40 dark:bg-green-900/30': isManuallyActivated(mod),
          'border-red-500 bg-red-100/40 text-red-700 line-through dark:bg-red-900/30 dark:text-red-300':
            isManuallyDeactivated(mod),
          'line-through opacity-50': isStackingLoser(mod)
        }
      ]"
      :key="'mod_' + mod.slug"
      @click="toggle(mod)"
    >
      <div class="text-right">
        <span v-if="mod.modifier !== undefined">{{ SignedNumber.format(mod.modifier) }}</span>
        <span v-if="mod.diceNumber">{{ `${mod.diceNumber}${mod.dieSize}` }}</span>
      </div>
      <div data-part="modifier-type" class="text-[0.65rem] tracking-wide uppercase opacity-60">
        <template v-if="mod.type && mod.type !== 'untyped'">[{{ mod.type }}]</template>
      </div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
      <div v-if="showDamageType && mod.damageType" class="text-sm opacity-70">
        ({{ mod.damageType }})
      </div>
    </li>
  </ul>
</template>
