<script setup lang="ts">
import { computed } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
const character = useInjectedCharacter()

const { max: bulkMax, encumberedAfter: bulkEncumberedAfter } = character.bulk
const { value: bulkValue } = character.bulk.value

// A readout line over a hairline rail, rather than a bar with the numbers set
// inside it. The numbers are what a player reads; the rail only has to answer
// "how close am I", which a few pixels of colour do as well as thirty.
//
// Plain elements rather than the SVG this used to be: at 6px there is nothing
// left to draw that a div can't, and it drops a whole coordinate system —
// widths are percentages, the threshold is a positioned tick.
function percent(of: number | undefined) {
  const max = bulkMax.value || 0
  if (!max) return '0%'
  return `${Math.min(100, Math.max(0, ((of ?? 0) / max) * 100))}%`
}

const encumberedAt = computed(() => percent(bulkEncumberedAfter.value))
const filled = computed(() => percent(bulkValue.value))

const state = computed(() => {
  const value = bulkValue.value ?? 0
  if (value < (bulkEncumberedAfter.value ?? 0)) return 'safe'
  return value < (bulkMax.value ?? 0) ? 'encumbered' : 'over-max'
})
</script>
<template>
  <!-- The utility classes are the unthemed ("None") treatment: without them
       this component is nothing but empty divs, since every dimension and
       colour it has otherwise comes from the theme layer. Themes override all
       of it. -->
  <div data-component="EquipmentBulk" v-if="bulkMax != null">
    <div data-part="bulk-readout" class="flex items-baseline justify-between gap-3 pb-1 text-xs">
      <span data-part="bulk-label">
        {{ $t('equipment.bulkReadout', { value: bulkValue, encumbered: bulkEncumberedAfter }) }}
      </span>
      <span data-part="bulk-max" class="text-gray-600">
        {{ $t('equipment.bulkMax', { max: bulkMax }) }}
      </span>
    </div>
    <div
      data-part="bulk-rail"
      class="relative h-2 overflow-hidden rounded-full border border-gray-400 bg-gray-200"
    >
      <!-- The stretch past the encumbrance threshold: a step of the track's
           own colour, since what state you are in is already carried by the
           fill. -->
      <div
        data-part="bulk-encumbered-zone"
        class="absolute inset-y-0 right-0 bg-gray-300"
        :style="{ left: encumberedAt }"
      />
      <div
        data-part="bulk-fill"
        :data-state="state"
        class="absolute inset-y-0 left-0 rounded-full data-[state=encumbered]:bg-amber-500 data-[state=over-max]:bg-red-600 data-[state=safe]:bg-green-500"
        :style="{ width: filled }"
      />
      <div
        data-part="bulk-threshold"
        class="absolute inset-y-0 w-px bg-gray-400"
        :style="{ left: encumberedAt }"
      />
    </div>
  </div>
</template>
