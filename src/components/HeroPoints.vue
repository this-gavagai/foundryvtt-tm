<script setup lang="ts">
import type { Ref } from 'vue'
import { inject, ref } from 'vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'
import Spinner from '@/components/Spinner.vue'
import Modal from '@/components/Modal.vue'

const counter = ref()

const character = inject(useKeys().characterKey)
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
