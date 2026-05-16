<script setup lang="ts">
import { ref } from 'vue'
import { useInjectedCharacter } from '@/composables/injectKeys'

import StatBox from '@/components/widgets/StatBox.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'

const counter = ref()

const character = useInjectedCharacter()
const { current: heroCurrent, max: heroMax } = character.heroPoints
</script>
<template>
  <div>
    <StatBox heading="Hero Pts" @click="counter.click()">
      <CounterWidget
        ref="counter"
        title="Hero Points"
        :value="heroCurrent ?? 0"
        :max="heroMax ?? 0"
        editable
        class="h-4"
        @change-count="
          (newTotal) => {
            heroCurrent = newTotal
          }
        "
      />
    </StatBox>
  </div>
</template>
