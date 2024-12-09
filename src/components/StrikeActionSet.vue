<script setup lang="ts">
import ActionIcons from './ActionIcons.vue'
import { capitalize } from '@/utils/utilities'

const { type, id, label, mapLabelSet } = defineProps(['type', 'id', 'label', 'mapLabelSet'])
const emit = defineEmits(['clicked'])
</script>
<template>
  <div>{{ label }}</div>
  <div class="flex flex-wrap leading-9">
    <span>
      <span
        v-for="(variant, index) in mapLabelSet"
        class="mb-1 mr-1 inline-block select-none border border-gray-400 bg-gray-100 p-2 text-xs text-blue-600 transition-colors active:bg-gray-300"
        @click="emit('clicked', id, { type, subtype: index })"
        :key="'variant_' + index"
      >
        <span v-if="!index">
          <ActionIcons actions="1" class="relative float-left mt-[-1px] h-0 text-lg leading-none" />
          <span class="pl-1">{{ capitalize(type) }}&nbsp;</span>
        </span>
        <span>{{ index ? variant.label?.match(/\((.*)\)/)?.pop() : variant.label }}</span>
      </span>
    </span>
    <span>
      <span
        v-for="(variant, index) in [{ label: 'Damage' }, { label: 'Critical' }]"
        class="mb-1 mr-1 inline-block select-none border border-gray-400 bg-gray-100 p-2 text-xs text-red-600 transition-colors active:bg-gray-300"
        @click="emit('clicked', id, { type: type + '_damage', subtype: index })"
        :key="'damage_' + index"
      >
        <span>{{ variant.label }}</span>
      </span>
    </span>
  </div>
</template>
