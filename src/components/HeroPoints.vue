<script setup lang="ts">
import type { Character } from '@/composables/character'
import { inject, ref } from 'vue'
import { useKeys } from '@/composables/injectKeys'

import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'

const counter = ref()

const character = inject(useKeys().characterKey) as Character
const { current: heroCurrent, max: heroMax } = character.heroPoints

function updateHeroPoints(newTotal: number): void {
  heroCurrent.value = newTotal
  counter.value.close()
}
</script>
<template>
  <Statistic heading="Hero Pts" @click="counter.click()">
    <Counter
      ref="counter"
      title="Hero Points"
      :value="heroCurrent ?? 0"
      :max="heroMax ?? 0"
      editable
      @change-count="(newTotal) => updateHeroPoints(newTotal)"
    />
  </Statistic>
</template>
