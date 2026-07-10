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
  <!-- display:contents keeps the buttons direct flex children of whatever row
       hosts this component (InfoModal's action row relies on its gap) while
       still giving the component the single root the lint config requires. -->
  <div class="contents">
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
  </div>
</template>
