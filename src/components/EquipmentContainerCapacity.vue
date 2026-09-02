<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { bulkParts } from '@/utils/formatters'
import type { ContainerCapacity } from '@/types/character-types'

// The per-container half of EquipmentBulk: same question ("how close am I"),
// asked of one backpack rather than the whole inventory, and answered the same
// way — the numbers on a line, a thin rail under it carrying proportion.
// Thinner than the Bulk rail and without its traffic lights, because a
// container has only one state worth colouring: over its capacity, where PF2e
// stops applying the Bulk it negates.
const props = defineProps<{ capacity?: ContainerCapacity }>()

const { t } = useI18n()

// A container that doesn't stow (a sheath, a bandolier) has no capacity of its
// own — PF2e zeroes it and counts the contents against the wearer directly — so
// there is no remainder to read out. Same shape as the field simply being
// absent, which is what an older module sends.
const shown = computed(() => (props.capacity?.max ?? 0) > 0)

const overCapacity = computed(() => (props.capacity?.percentFull ?? 0) > 100)
const filled = computed(() => `${Math.min(100, Math.max(0, props.capacity?.percentFull ?? 0))}%`)

// "2, 3L" — the mixed unit PF2e prints, assembled from the localized pieces
// rather than a decimal, since 2.3 Bulk is not a quantity anyone plays with.
const valueLabel = computed(() => {
  const { normal, light } = bulkParts(props.capacity?.value)
  if (light === 0) return String(normal)
  if (normal === 0) return t('equipment.bulkLight', { light })
  return t('equipment.bulkWithLight', { bulk: normal, light })
})

// The one line of consequence a container carries. Over capacity comes first
// because it is also *why* the negation below it has stopped applying; the
// negation is reported as the number PF2e is currently applying, so when it has
// lapsed for some other reason (an extradimensional bag inside another one)
// this says nothing rather than something wrong.
const note = computed(() => {
  if (overCapacity.value) return t('equipment.containerOverCapacity')
  const ignored = props.capacity?.ignored ?? 0
  return ignored > 0 ? t('equipment.containerNegatesBulk', { bulk: ignored }) : undefined
})
</script>
<template>
  <!-- The utility classes are the unthemed ("None") treatment, as in
       EquipmentBulk: themes override every dimension and colour below. -->
  <div data-component="EquipmentContainerCapacity" v-if="shown">
    <div
      data-part="capacity-readout"
      class="flex items-baseline justify-between gap-2 pb-0.5 text-[0.7rem] text-gray-600"
    >
      <span data-part="capacity-value">
        {{ $t('equipment.containerCapacity', { value: valueLabel, max: capacity?.max }) }}
      </span>
      <span
        v-if="note"
        data-part="capacity-note"
        :data-state="overCapacity ? 'over' : 'negating'"
        class="data-[state=over]:text-red-600"
      >
        {{ note }}
      </span>
    </div>
    <div data-part="capacity-rail" class="relative h-1 overflow-hidden rounded-full bg-gray-200">
      <div
        data-part="capacity-fill"
        :data-state="overCapacity ? 'over' : 'within'"
        class="absolute inset-y-0 left-0 rounded-full bg-gray-400 data-[state=over]:bg-red-600"
        :style="{ width: filled }"
      />
    </div>
  </div>
</template>
