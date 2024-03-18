<script setup lang="ts">
import { inject, ref } from 'vue'
import { parseIncrement } from '@/utils/utilities'
import { updateActor } from '@/utils/api'

import Statistic from '@/components/Statistic.vue'
import Modal from '@/components/Modal.vue'

const actor: any = inject('actor')
const experienceModal = ref()
const focusTarget = ref()

function updateExperience(input: string) {
  let newValue: number = parseIncrement(input, actor.value.system?.details.xp.value)
  newValue = Math.max(newValue, 0)
  updateActor(actor, { system: { details: { xp: { value: newValue } } } })
}
</script>
<template>
  <Statistic heading="Experience" @click="experienceModal.open()">
    <div class="py-1">
      <svg width="75" height="18">
        <rect
          :width="
            75 * ((actor.system?.details.xp.value ?? 0) / (actor.system?.details.xp.max ?? 1))
          "
          height="18"
          style="fill: #ccc"
        />
        <rect
          width="75"
          height="18"
          style="fill: transparent; stroke-width: 3; stroke: rgb(0, 0, 0)"
        />
        <text y="12" x="31" stroke="black" font-size="7pt" font-weight="lighter">
          {{ actor.system?.details.xp.value }}
        </text>
      </svg>
    </div>
  </Statistic>
  <Teleport to="#modals">
    <Modal ref="experienceModal" title="Experience Points" :focusTarget="focusTarget">
      <form
        @submit.prevent="
          (e: any) => {
            updateExperience(e.target[0].value)
            experienceModal.close()
          }
        "
      >
        <div class="w-full pt-4 text-3xl flex justify-center items-center">
          <input
            class="text-3xl border-2 border-black w-36 p-1 mr-4 text-right"
            name="xp"
            type="number"
            pattern="[+-]{0,1}[0-9]*"
            :placeholder="actor.system?.details.xp.value"
            @focus="(e: any) => e.target.select()"
            ref="focusTarget"
          />
        </div>
        <div class="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
          <button
            type="submit"
            class="inline-flex w-full justify-center bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 sm:ml-3 sm:w-auto"
          >
            Update
          </button>
        </div>
      </form>
    </Modal>
  </Teleport>
</template>
