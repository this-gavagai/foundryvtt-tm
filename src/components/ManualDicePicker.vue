<script setup lang="ts">
import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'
import d20Icon from '@/assets/icons/d20.svg'

const dieIcons: Record<string, string> = {
  d4: d4Icon,
  d6: d6Icon,
  d8: d8Icon,
  d10: d10Icon,
  d12: d12Icon,
  d20: d20Icon
}

defineProps<{
  dice: string[]
  buffer: (number | undefined)[]
  dieFaces: (die: string) => number[]
}>()

defineEmits<{
  'pick-face': [slot: number, face: number]
}>()
</script>

<template>
  <div data-component="ManualDicePicker" data-part="face-picker" class="mt-4 flex flex-col gap-1">
    <div v-for="(die, slot) in dice" :key="slot + '_' + die" class="flex items-start gap-2">
      <div class="flex w-10 shrink-0 items-center gap-1 pt-0.5">
        <img :src="dieIcons[die] ?? d20Icon" class="h-5" />
        <span class="text-xs uppercase opacity-60">{{ die }}</span>
      </div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="face in dieFaces(die)"
          :key="face"
          type="button"
          :data-selected="buffer[slot] === face ? true : undefined"
          class="h-6 w-6 cursor-pointer rounded border text-xs leading-none"
          :class="buffer[slot] === face ? 'bg-gray-300 hover:bg-gray-400' : ''"
          @click="$emit('pick-face', slot, face)"
        >
          {{ face }}
        </button>
      </div>
    </div>
  </div>
</template>
