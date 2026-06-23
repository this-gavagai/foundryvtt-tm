<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Spell, SpellcastingEntry } from '@/composables/character'

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

const buttonClass =
  'inline-block cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 transition duration-180 ease-out select-none active:scale-[0.90] active:opacity-50 active:duration-60'
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
      <span
        :class="buttonClass"
        class="whitespace-nowrap text-blue-600"
        @click="emit('pick', spell, entry, rank, 'attack', 0)"
        >{{ $t('spells.attack') }}</span
      >
      <span
        :class="buttonClass"
        class="w-9 text-center text-blue-600"
        @click="emit('pick', spell, entry, rank, 'attack', 1)"
        >-5</span
      >
      <span
        :class="buttonClass"
        class="w-9 text-center text-blue-600"
        @click="emit('pick', spell, entry, rank, 'attack', 2)"
        >-10</span
      >
    </span>
    <span data-part="damage" v-if="spell.system?.hasDamage" class="flex gap-1">
      <span
        :class="buttonClass"
        class="whitespace-nowrap text-red-600"
        @click="emit('pick', spell, entry, rank, 'damage', 0)"
        >{{ $t('spells.damage') }}</span
      >
    </span>
  </div>
</template>
