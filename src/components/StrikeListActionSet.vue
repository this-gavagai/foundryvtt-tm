<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionIcons from './widgets/ActionIcons.vue'

import melee from '@/assets/icons/plain-dagger.svg'
import ranged from '@/assets/icons/high-shot.svg'

const { t } = useI18n()

const props = defineProps<{
  type: string
  id: number | string
  label?: string
  mapLabelSet?: { label?: string }[]
  isRanged?: boolean
  range?: number
}>()
const emit = defineEmits(['clicked'])

// Render the leading button as a localized "Strike" or "Blast" based on type.
const typeLabel = computed(() =>
  props.type === 'blast' ? t('strikes.blast') : t('strikes.strike')
)
const damageVariants = computed(() => [
  { label: t('strikes.damage') },
  { label: t('strikes.critical') }
])
</script>
<template>
  <div>
    <div class="align-items-middle flex">
      <div>{{ label }}</div>
      <img
        :src="isRanged ? ranged : melee"
        class="mt-1 ml-2 h-4"
        :alt="isRanged ? $t('strikes.rangedIcon') : $t('strikes.meleeIcon')"
      />
      <div v-if="range" class="pt-1 text-xs">&nbsp;({{ range }} {{ $t('strikes.rangeUnit') }})</div>
    </div>
    <div data-part="strike-buttons" class="flex flex-wrap leading-9">
      <span data-part="attack">
        <span
          v-for="(variant, index) in mapLabelSet"
          class="mr-1 mb-1 inline-block border border-gray-400 bg-gray-100 p-2 text-xs whitespace-nowrap text-blue-600 transition-colors select-none active:bg-gray-300"
          :class="index ? 'w-17' : 'w-22.5'"
          @click="emit('clicked', id, { type, subtype: index })"
          :key="'variant_' + index"
        >
          <span v-if="!index">
            <ActionIcons
              actions="1"
              class="relative float-left mt-[-1px] h-0 text-lg leading-none"
            />
            <span class="pl-1">{{ typeLabel }}&nbsp;</span>
          </span>
          <span>{{ index ? (variant.label?.match(/\((.*)\)/)?.pop() || variant.label || '—') : variant.label }}</span>
        </span>
      </span>
      <span data-part="damage">
        <span
          v-for="(variant, index) in damageVariants"
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
