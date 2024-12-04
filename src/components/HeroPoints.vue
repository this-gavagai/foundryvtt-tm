<script setup lang="ts">
import type { Character } from '@/composables/character'
import { inject, ref } from 'vue'
import { useKeys } from '@/composables/injectKeys'

import StatBox from '@/components/StatBox.vue'
import CounterWidget from '@/components/CounterWidget.vue'

const counter = ref()

const character = inject(useKeys().characterKey) as Character
const { current: heroCurrent, max: heroMax } = character.heroPoints
</script>
<template>
  <StatBox heading="Hero Pts" @click="counter.click()">
    <CounterWidget
      ref="counter"
      title="Hero Points"
      :value="heroCurrent ?? 0"
      :max="heroMax ?? 0"
      editable
      @change-count="
        (newTotal) => {
          heroCurrent = newTotal
          counter.value.close()
        }
      "
    />
  </StatBox>
</template>
