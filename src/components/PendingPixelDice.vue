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
  readyFaceCounts: Set<number>
}>()

defineEmits<{
  clear: []
}>()
</script>

<template>
  <div
    data-component="PendingPixelDice"
    class="flex cursor-pointer items-center gap-1"
    :title="$t('infoModal.clearDicePending')"
    @click="$emit('clear')"
  >
    <template v-for="(die, slot) in dice" :key="slot + '_' + die">
      <div
        v-if="readyFaceCounts.has(Number(die.slice(1)))"
        class="relative flex h-8 items-center"
      >
        <img
          :src="dieIcons[die] ?? d20Icon"
          class="h-8 transition-opacity"
          :class="buffer[slot] !== undefined ? 'opacity-20' : 'animate-bounce opacity-50'"
        />
        <span
          v-if="buffer[slot] !== undefined"
          class="absolute inset-0 flex items-center justify-center text-xs font-bold"
        >
          {{ buffer[slot] }}
        </span>
      </div>
    </template>
  </div>
</template>
