<script setup lang="ts">
import { inject } from 'vue'
import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'

const actor: any = inject('actor')

// const props = defineProps(['actor'])
</script>
<template>
  <div class="border border-t-0 px-6 py-4 flex gap-8">
    <Statistic heading="Hitpoints">
      {{ actor.system?.attributes.hp.value ?? '??' }} /
      {{ actor.system?.attributes.hp.max ?? '??' }}
    </Statistic>
    <Statistic heading="Hero Pts">
      <Counter
        :value="actor.system?.resources.heroPoints.value ?? '0'"
        :max="actor.system?.resources.heroPoints.max ?? '0'"
      />
    </Statistic>
    <Statistic heading="Experience">
      <div class="py-1">
        <svg width="60" height="14">
          <rect
            :width="
              60 * ((actor.system?.details.xp.value ?? 0) / (actor.system?.details.xp.max ?? 1))
            "
            height="14"
            style="fill: #ccc"
          />
          <rect
            width="60"
            height="14"
            style="fill: transparent; stroke-width: 3; stroke: rgb(0, 0, 0)"
          />
          <text y="10" x="21" stroke="black" font-size="7pt" font-weight="lighter">
            {{ actor.system?.details.xp.value }}
          </text>
        </svg>
      </div>
    </Statistic>
  </div>
</template>
