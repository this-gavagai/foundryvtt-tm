<script setup lang="ts">

import { useInjectedCharacter } from '@/composables/injectKeys'
const character = useInjectedCharacter()

const { max: bulkMax, encumberedAfter: bulkEncumberedAfter } = character.bulk
const { value: bulkValue, normal: bulkNormal } = character.bulk.value
</script>
<template>
  <svg
    data-component="EquipmentBulk"
    width="100%"
    height="30"
    class="trasition-all duration-500"
    v-if="bulkNormal && bulkMax"
  >
    <pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
      <path
        d="M-1,1 l2,-2
           M0,4 l4,-4
           M3,5 l2,-2"
        data-part="hatch-line"
        class="stroke-1 stroke-red-400"
      />
    </pattern>
    <rect
      data-part="bulk-hatch"
      width="100%"
      height="100%"
      fill="url(#diagonalHatch)"
      class="transition-all duration-500 ease-in-out"
    />
    <rect
      data-part="bulk-safe"
      :width="((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      height="100%"
      class="fill-gray-200 transition-all duration-500 ease-in-out"
    />
    <rect
      data-part="bulk-fill"
      :data-state="
        (bulkNormal ?? 0) < (bulkEncumberedAfter ?? 0)
          ? 'safe'
          : (bulkNormal ?? 0) < (bulkMax ?? 0)
            ? 'encumbered'
            : 'over-max'
      "
      :width="((bulkNormal ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      height="100%"
      class="transition-all duration-500 ease-in-out data-[state=safe]:fill-green-500 data-[state=encumbered]:fill-amber-500 data-[state=over-max]:fill-red-600"
    />
    <rect
      data-part="bulk-border"
      width="100%"
      height="100%"
      fill="transparent"
      class="stroke-1 stroke-gray-400"
    />
    <text
      data-part="bulk-label"
      y="20"
      x="6"
      font-size="10pt"
      font-weight="lighter"
      class="fill-gray-900 font-medium"
    >
      Current Bulk: {{ bulkValue }} / {{ bulkEncumberedAfter }}
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
      Max: {{ bulkMax }}&nbsp;&nbsp;
    </text>
  </svg>
</template>
