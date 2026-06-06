<script setup lang="ts">
import Button from '@/components/widgets/ButtonWidget.vue'
import type { Roll } from '@/types/roll-types'

defineProps<{
  rolls?: Roll[]
  armedRoll?: Roll
}>()

defineEmits<{
  'execute-roll': [roll: Roll]
}>()
</script>

<template>
  <Button
    v-for="roll in rolls ?? []"
    :key="roll.key"
    :color="roll.color ?? 'blue'"
    :disabled="roll.disabled"
    :data-armed="roll.key === armedRoll?.key ? true : undefined"
    :clicked="() => $emit('execute-roll', roll)"
  >
    {{ roll.label }}
  </Button>
</template>
