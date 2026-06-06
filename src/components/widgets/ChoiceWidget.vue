<script setup lang="ts">
import { ref } from 'vue'
import ChoiceWidgetButton from './ChoiceWidgetButton.vue'

const waiting = ref(false)
const {
  choiceSet = [],
  iconSet = {},
  labelSet = {},
  selected = '',
  clicked,
  size = 'md'
} = defineProps<{
  choiceSet: string[]
  iconSet?: Record<string, string>
  labelSet?: Record<string, string>
  selected?: string
  clicked?: (newChoice: string) => void
  size?: 'sm' | 'md'
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
    class="isolate mb-2 flex overflow-hidden rounded-lg border border-gray-400 shadow-inner transition-opacity"
    :class="[waiting ? 'opacity-50' : '']"
    v-if="choiceSet.length > 1"
    :waiting
  >
    <ChoiceWidgetButton
      v-for="choice in choiceSet as string[]"
      :key="choice"
      :icon="iconSet[choice] ?? ''"
      :label="labelSet[choice] ?? ''"
      :choice="choice"
      :selected="selected"
      :disabled="waiting"
      :size="size"
      @click="() => handleChanged(choice)"
    />
    <!-- </span> -->
  </div>
</template>
