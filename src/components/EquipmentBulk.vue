<script setup lang="ts">
import { inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'
const character = inject(useKeys().characterKey)!

const { max: bulkMax, encumberedAfter: bulkEncumberedAfter } = character.bulk
const { value: bulkValue, normal: bulkNormal } = character.bulk.value
</script>
<template>
  <svg width="100%" height="30" class="trasition-all duration-500" v-if="bulkNormal && bulkMax">
    <pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
      <path
        d="M-1,1 l2,-2
           M0,4 l4,-4
           M3,5 l2,-2"
        style="stroke: #faa; stroke-width: 1"
      />
    </pattern>
    <rect
      width="100%"
      height="100%"
      fill="url(#diagonalHatch)"
      class="trasition-all duration-500 ease-in-out"
    />
    <rect
      :width="((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      height="100%"
      style="fill: white"
      class="trasition-all duration-500 ease-in-out"
    />
    <rect
      :width="((bulkNormal ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
      height="100%"
      style="stroke-width: 1; stroke: black"
      :style="
        'fill: ' +
        ((bulkNormal ?? 0) < (bulkEncumberedAfter ?? 0)
          ? '#8c8'
          : (bulkNormal ?? 0) < (bulkMax ?? 0)
            ? '#ee5'
            : '#c88')
      "
      class="trasition-all duration-500 ease-in-out"
    />
    <rect
      width="100%"
      height="100%"
      style="fill: transparent; stroke-width: 3; stroke: rgb(100, 100, 100)"
    />
    <text y="20" x="6" stroke="black" font-size="10pt" font-weight="lighter">
      Current Bulk: {{ bulkValue }} / {{ bulkEncumberedAfter }}
    </text>
    <text y="20" x="100%" text-anchor="end" stroke="black" font-size="10pt" font-weight="lighter">
      Max: {{ bulkMax }}&nbsp;&nbsp;
    </text>
  </svg>
</template>
