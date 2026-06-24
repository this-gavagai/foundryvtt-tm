<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Spell, SpellcastingEntry } from '@/composables/character'
import RollButton from '@/components/widgets/RollButton.vue'

defineProps<{
  spell: Spell | undefined
  entry?: SpellcastingEntry
  rank: number
}>()

const emit = defineEmits<{
  pick: [
    spell: Spell,
    entry: SpellcastingEntry | undefined,
    rank: number,
    phase: 'attack' | 'damage',
    map: 0 | 1 | 2
  ]
}>()

const { isListening } = storeToRefs(useListenersStore())

const buttonClass = 'px-2 py-1'
</script>
<template>
  <div
    v-if="
      isListening &&
      spell &&
      (spell.system?.traits?.value?.includes('attack') || spell.system?.hasDamage)
    "
    data-part="spell-roll-buttons"
    class="flex flex-wrap items-center gap-1 text-xs"
  >
    <span
      data-part="attack"
      v-if="spell.system?.traits?.value?.includes('attack')"
      class="flex gap-1"
    >
      <RollButton
        :class="buttonClass"
        class="whitespace-nowrap text-blue-600"
        @click="emit('pick', spell, entry, rank, 'attack', 0)"
        >{{ $t('spells.attack') }}</RollButton
      >
      <RollButton
        :class="buttonClass"
        class="w-9 text-center text-blue-600"
        @click="emit('pick', spell, entry, rank, 'attack', 1)"
        >-5</RollButton
      >
      <RollButton
        :class="buttonClass"
        class="w-9 text-center text-blue-600"
        @click="emit('pick', spell, entry, rank, 'attack', 2)"
        >-10</RollButton
      >
    </span>
    <span data-part="damage" v-if="spell.system?.hasDamage" class="flex gap-1">
      <RollButton
        :class="buttonClass"
        class="whitespace-nowrap text-red-600"
        @click="emit('pick', spell, entry, rank, 'damage', 0)"
        >{{ $t('spells.damage') }}</RollButton
      >
    </span>
  </div>
</template>
