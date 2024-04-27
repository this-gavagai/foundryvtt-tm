<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject, ref } from 'vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'
import Spinner from '@/components/Spinner.vue'
import Modal from '@/components/Modal.vue'

import { PlusCircleIcon, MinusCircleIcon } from '@heroicons/vue/24/outline'

const actor = inject(useKeys().actorKey)!
const counter = ref()
const { updateActor } = useApi()
const updating = ref(false)

function updateHeroPoints(newTotal: number): void {
  updating.value = true
  if (actor.value) {
    updateActor(actor as Ref<Actor>, {
      system: { resources: { heroPoints: { value: newTotal } } }
    }).then(() => (updating.value = false))
    actor.value.system.resources.heroPoints.value = newTotal
    counter.value.close()
  }
}
</script>
<template>
  <Statistic heading="Hero Pts" @click="counter.click()">
    <Counter
      ref="counter"
      title="Hero Points"
      :value="actor?.system?.resources.heroPoints.value ?? 0"
      :max="actor?.system?.resources.heroPoints.max ?? 0"
      :updating="updating"
      editable
      @change-count="(newTotal) => updateHeroPoints(newTotal)"
    />
  </Statistic>
  <!-- <Spinner v-if="updating" class="h-8" /> -->
</template>
