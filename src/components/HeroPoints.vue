<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { inject, ref } from 'vue'
import { useServer } from '@/composables/server'
import { updateActor } from '@/utils/api'

import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'
import Modal from '@/components/Modal.vue'

import { PlusCircleIcon, MinusCircleIcon } from '@heroicons/vue/24/outline'

const actor: Ref<Actor | undefined> = inject('actor')!
const heropointsModal = ref()
const counter = ref()

const { socket } = useServer()

function updateHeroPoints(newTotal: number): void {
  if (actor.value)
    updateActor(actor as Ref<Actor>, { system: { resources: { heroPoints: { value: newTotal } } } })
}
</script>
<template>
  <Statistic heading="Hero Pts" @click="counter.click()">
    <Counter
      ref="counter"
      title="Hero Points"
      :value="actor?.system?.resources.heroPoints.value ?? '0'"
      :max="actor?.system?.resources.heroPoints.max ?? '0'"
      editable
      @change-count="(newTotal) => updateHeroPoints(newTotal)"
    />
  </Statistic>
</template>
@/composables/server
