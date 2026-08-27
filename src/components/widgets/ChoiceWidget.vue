<script setup lang="ts">
import { ref } from 'vue'
import ChoiceWidgetButton from './ChoiceWidgetButton.vue'

const waiting = ref(false)
const {
  choiceSet = [],
  iconSet = {},
  glyphSet = {},
  labelSet = {},
  selected = '',
  clicked,
  size = 'md',
  direction = 'row'
} = defineProps<{
  choiceSet: string[]
  iconSet?: Record<string, string>
  // Pathfinder action-cost glyphs ('1', '2', '3', 'reaction', …), rendered with
  // the same glyph font the rest of the sheet uses. An alternative to iconSet
  // for costs that have no SVG asset — there is no action3.svg.
  glyphSet?: Record<string, string>
  labelSet?: Record<string, string>
  selected?: string
  clicked?: (newChoice: string) => void
  size?: 'sm' | 'md'
  // Segmented row by default. 'column' stacks full-width rows instead, for
  // choices whose labels are too long to share a row on a phone.
  direction?: 'row' | 'column'
}>()
const emit = defineEmits(['changed'])
defineExpose({ waiting })
function handleChanged(newChoice: string) {
  emit('changed', newChoice)
  if (clicked) {
    waiting.value = true
    const response = clicked?.(newChoice)
    Promise.resolve(response).then(() => (waiting.value = false))
  }
}
</script>

<template>
  <div
    data-component="ChoiceWidget"
    class="isolate mb-2 flex overflow-hidden rounded-xs border border-gray-400 shadow-inner transition-opacity"
    :class="[waiting ? 'opacity-50' : '', direction === 'column' ? 'flex-col' : '']"
    v-if="choiceSet.length > 1"
    :waiting
  >
    <ChoiceWidgetButton
      v-for="choice in choiceSet as string[]"
      :key="choice"
      :icon="iconSet[choice] ?? ''"
      :glyph="glyphSet[choice] ?? ''"
      :label="labelSet[choice] ?? ''"
      :choice="choice"
      :selected="selected"
      :disabled="waiting"
      :size="size"
      :direction="direction"
      @click="() => handleChanged(choice)"
    />
    <!-- </span> -->
  </div>
</template>
