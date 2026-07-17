<script setup lang="ts">
import { useInjectedCharacter } from '@/composables/injectKeys'
const character = useInjectedCharacter()

const { max: bulkMax, encumberedAfter: bulkEncumberedAfter } = character.bulk
const { value: bulkValue } = character.bulk.value
</script>
<template>
  <svg
    data-component="EquipmentBulk"
    width="100%"
    height="30"
    class="transition-all duration-500"
    v-if="bulkMax != null"
    :style="`--bulk-safe-width: ${((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100}%`"
  >
    <rect
      data-part="bulk-hatch"
      width="100%"
      height="100%"
      class="fill-yellow-100 transition-all duration-500 ease-in-out"
    />
    <rect
      data-part="bulk-safe"
      :width="((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      height="100%"
      class="fill-gray-100 transition-all duration-500 ease-in-out"
    />
    <rect
      data-part="bulk-fill"
      :data-state="
        (bulkValue ?? 0) < (bulkEncumberedAfter ?? 0)
          ? 'safe'
          : (bulkValue ?? 0) < (bulkMax ?? 0)
            ? 'encumbered'
            : 'over-max'
      "
      :width="((bulkValue ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      height="100%"
      class="transition-all duration-500 ease-in-out data-[state=encumbered]:fill-amber-500 data-[state=over-max]:fill-red-600 data-[state=safe]:fill-green-500"
    />
    <line
      data-part="bulk-safe-divider"
      :x1="((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      y1="0"
      :x2="((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      y2="100%"
    />
    <rect data-part="bulk-border" width="100%" height="100%" rx="5" fill="transparent" class="" />
    <text
      data-part="bulk-label"
      y="20"
      x="6"
      font-size="10pt"
      font-weight="lighter"
      class="fill-gray-900 font-medium"
    >
      {{ $t('equipment.currentBulk') }}: {{ bulkValue }} / {{ bulkEncumberedAfter }}
    </text>
    <text
      data-part="bulk-label"
      y="20"
      x="100%"
      text-anchor="end"
      font-size="10pt"
      font-weight="lighter"
      class="fill-gray-900 font-medium"
    >
      {{ $t('equipment.maxBulk') }}: {{ bulkMax }}&nbsp;&nbsp;
    </text>
  </svg>
</template>
