<script setup lang="ts">
import { ref } from 'vue'
import ChoiceWidgetButton from './ChoiceWidgetButton.vue'

const waiting = ref(false)
const {
  label = '',
  choiceSet = [],
  iconSet = {},
  selected = ''
} = defineProps<{
  label?: string
  choiceSet: string[]
  iconSet?: Record<string, string>
  selected?: string
}>()
const emit = defineEmits(['changed'])
defineExpose({ waiting })
</script>

<template>
  <div class="flex justify-end gap-2" v-if="choiceSet.length > 1" :waiting>
    <div v-if="label" class="mt-2 italic">{{ label }}</div>
    <span
      class="isolate mb-2 inline-flex rounded-md transition-opacity"
      :class="{ 'opacity-50': waiting }"
    >
      <ChoiceWidgetButton
        v-for="damageType in choiceSet as string[]"
        :key="damageType"
        :icon="iconSet[damageType] ?? ''"
        :choice="damageType"
        :selected="selected"
        :disabled="waiting"
        @click="emit('changed', damageType)"
      />
    </span>
  </div>
</template>
