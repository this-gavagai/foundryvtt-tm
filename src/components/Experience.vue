<script setup lang="ts">
import type { Ref } from 'vue'
import { inject, ref } from 'vue'
import { parseIncrement } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import Statistic from '@/components/Statistic.vue'
import Modal from '@/components/Modal.vue'

interface FormData {
  xp: { value: string }
}
interface InputSelect {
  select: () => void
}

const experienceModal = ref()

const character = inject(useKeys().characterKey)
const { current: xpCurrent, max: xpMax } = character.xp

function updateExperience(input: string) {
  let newValue: number = parseIncrement(input, actor.value?.system?.details.xp.value)
  newValue = Math.max(newValue, 0)
  xpCurrent.value = newValue
}
</script>
<template>
  <Statistic heading="Experience" @click="experienceModal.open()" class="cursor-pointer">
    <div class="py-1">
      <svg width="75" height="18">
        <rect :width="75 * ((xpCurrent ?? 0) / (xpMax ?? 1))" height="18" style="fill: #ccc" />
        <rect
          width="75"
          height="18"
          style="fill: transparent; stroke-width: 3; stroke: rgb(0, 0, 0)"
        />
        <text y="12" x="31" stroke="black" font-size="7pt" font-weight="lighter">
          {{ xpCurrent }}
        </text>
      </svg>
    </div>
  </Statistic>
  <Teleport to="#modals">
    <Modal ref="experienceModal" title="Experience Points">
      <form
        @submit.prevent="
          (e: Event) => {
            console.log(e)
            const { xp } = e.target as EventTarget & FormData
            if (e.target) updateExperience(xp.value)
            experienceModal.close()
          }
        "
      >
        <div class="flex w-full items-center justify-center pt-4 text-3xl">
          <input
            class="mr-4 w-36 border-2 border-black p-1 text-right text-3xl"
            id="xp"
            name="xp"
            type="input"
            pattern="[\+\-]{0,1}[0-9]*"
            :value="xpCurrent"
            @focus="
              (e: Event) => {
                const field = e.target as EventTarget & InputSelect
                field.select()
              }
            "
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
