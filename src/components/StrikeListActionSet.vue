<script setup lang="ts">
import ActionIcons from './widgets/ActionIcons.vue'
import { capitalize } from 'lodash-es'

import melee from '@/assets/icons/plain-dagger.svg'
import ranged from '@/assets/icons/high-shot.svg'

const { type, id, label, mapLabelSet, isRanged, range } = defineProps([
  'type',
  'id',
  'label',
  'mapLabelSet',
  'isRanged',
  'range'
])
const emit = defineEmits(['clicked'])
</script>
<template>
  <div>
    <div class="align-items-middle flex">
      <div>{{ label }}</div>
      <img
        :src="isRanged ? ranged : melee"
        class="mt-1 ml-2 h-4"
        :alt="isRanged ? 'ranged icon' : 'melee icon'"
      />
      <div v-if="range" class="pt-1 text-xs">&nbsp;({{ range }} ft.)</div>
    </div>
    <div class="flex flex-wrap leading-9">
      <span>
        <span
          v-for="(variant, index) in mapLabelSet"
          class="mr-1 mb-1 inline-block border border-gray-400 bg-gray-100 p-2 text-xs whitespace-nowrap text-blue-600 transition-colors select-none active:bg-gray-300"
          :class="[index ? 'w-[4.25rem]' : 'w-[5.625rem]']"
          @click="emit('clicked', id, { type, subtype: index })"
          :key="'variant_' + index"
        >
          <span v-if="!index">
            <ActionIcons
              actions="1"
              class="relative float-left mt-[-1px] h-0 text-lg leading-none"
            />
            <span class="pl-1">{{ capitalize(type) }}&nbsp;</span>
          </span>
          <span>{{ index ? variant.label?.match(/\((.*)\)/)?.pop() : variant.label }}</span>
        </span>
      </span>
      <span>
        <span
          v-for="(variant, index) in [{ label: 'Damage' }, { label: 'Critical' }]"
          class="mr-1 mb-1 inline-block border border-gray-400 bg-gray-100 p-2 text-xs text-red-600 transition-colors select-none active:bg-gray-300"
          @click="emit('clicked', id, { type: type + '_damage', subtype: index })"
          :key="'damage_' + index"
        >
          <span class="overflow-hidden whitespace-nowrap">{{ variant.label }}</span>
        </span>
      </span>
    </div>
  </div>
</template>
