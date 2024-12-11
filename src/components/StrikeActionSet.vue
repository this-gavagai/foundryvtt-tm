<script setup lang="ts">
import ActionIcons from './ActionIcons.vue'
import { capitalize } from 'lodash-es'

import melee from '@/assets/icons/plain-dagger.svg'
import ranged from '@/assets/icons/high-shot.svg'

const { type, id, label, mapLabelSet, isRanged } = defineProps([
  'type',
  'id',
  'label',
  'mapLabelSet',
  'isRanged'
])
const emit = defineEmits(['clicked'])
</script>
<template>
  <div class="align-items-middle flex">
    <img :src="isRanged ? ranged : melee" class="mr-1 mt-1 h-4" />
    <div>{{ label }}</div>
  </div>
  <div class="flex flex-wrap leading-9">
    <span>
      <span
        v-for="(variant, index) in mapLabelSet"
        class="mb-1 mr-1 inline-block select-none border border-gray-400 bg-gray-100 p-2 text-xs text-blue-600 transition-colors active:bg-gray-300"
        :class="[index ? 'w-[4.25rem]' : 'w-[5.625rem]']"
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
        <span class="overflow-hidden whitespace-nowrap">{{ variant.label }}</span>
      </span>
    </span>
  </div>
</template>
