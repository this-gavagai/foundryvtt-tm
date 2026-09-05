<script setup lang="ts">
import StatBox from './widgets/StatBox.vue'
import { useInjectedActor } from '@/composables/injectKeys'
import { useDerivedStale } from '@/composables/useDerivedStale'

const { _id, ac } = useInjectedActor()
const { current, modifiers, provisional, caveat } = ac

// AC is derived: PF2e recomputes it from the armour worn, shields raised and
// items invested. Equipping something writes the item directly and this number
// does not move until a GM answers the refresh — so while none can, say so.
const derivedStale = useDerivedStale(_id)
</script>
<template>
  <StatBox :heading="$t('ac.heading')" :modifiers="modifiers">
    <!-- Two different doubts, one visual language. `stale` is PF2e's number
         gone out of date; `provisional` is this device's arithmetic standing in
         for it, with the rule engine's gaps named in the tooltip. Neither may
         look like a figure the GM has confirmed. -->
    <div
      :data-derived-stale="derivedStale || undefined"
      :data-derived-provisional="provisional || undefined"
      :title="
        derivedStale
          ? $t('sync.awaitingGm')
          : provisional
            ? $t('sync.provisional', { caveat })
            : undefined
      "
    >
      {{ current ?? '??' }}
    </div>
  </StatBox>
</template>
