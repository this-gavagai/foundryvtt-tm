<script setup lang="ts">
import Button from '@/components/widgets/ButtonWidget.vue'
import type { Roll } from '@/types/roll-types'

const props = defineProps<{
  rolls?: Roll[]
  armedRoll?: Roll
  executeRoll: (roll: Roll) => Promise<unknown> | void
}>()
</script>

<template>
  <Button
    v-for="roll in rolls ?? []"
    :key="roll.key"
    :color="roll.color ?? 'blue'"
    :disabled="roll.disabled"
    :data-armed="roll.key === armedRoll?.key ? true : undefined"
    :clicked="() => props.executeRoll(roll)"
  >
    {{ roll.label }}
  </Button>
</template>
