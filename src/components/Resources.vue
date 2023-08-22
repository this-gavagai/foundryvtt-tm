<script setup lang="ts">
import { useSheet } from '@/stores/sheet'
import { storeToRefs } from 'pinia'

import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'

const sheet = useSheet()
const { actor } = storeToRefs(sheet)
</script>
<template>
  <div class="border border-t-0 px-6 py-4 flex gap-8">
    <Statistic heading="Hitpoints">
      {{ actor.system.attributes.hp.value }} / {{ actor.system.attributes.hp.max }}
    </Statistic>
    <Statistic heading="Hero Pts">
      <Counter
        :value="actor.system.resources.heroPoints.value"
        :max="actor.system.resources.heroPoints.max"
      />
    </Statistic>
    <Statistic heading="Experience">
      <div class="py-1">
        <svg width="60" height="14">
          <rect
            :width="60 * (actor.system.details.xp.value / actor.system.details.xp.max)"
            height="14"
            style="fill: #ccc"
          />
          <rect
            width="60"
            height="14"
            style="fill: transparent; stroke-width: 3; stroke: rgb(0, 0, 0)"
          />
          <text y="10" x="21" stroke="black" font-size="7pt" font-weight="lighter">
            {{ actor.system.details.xp.value }}
          </text>
        </svg>
      </div>
    </Statistic>
  </div>
</template>
