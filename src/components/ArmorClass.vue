<script setup lang="ts">
import StatBox from './widgets/StatBox.vue'
import { useInjectedActor } from '@/composables/injectKeys'
import { useDerivedStale } from '@/composables/useDerivedStale'

const { _id, ac } = useInjectedActor()
const { current, modifiers } = ac

// AC is derived: PF2e recomputes it from the armour worn, shields raised and
// items invested. Equipping something writes the item directly and this number
// does not move until a GM answers the refresh — so while none can, say so.
const derivedStale = useDerivedStale(_id)
</script>
<template>
  <StatBox :heading="$t('ac.heading')" :modifiers="modifiers">
    <div
      :data-derived-stale="derivedStale || undefined"
      :title="derivedStale ? $t('sync.awaitingGm') : undefined"
    >
      {{ current ?? '??' }}
    </div>
  </StatBox>
</template>
