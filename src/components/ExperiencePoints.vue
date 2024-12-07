<script setup lang="ts">
import type { Character } from '@/composables/character'
import { inject, ref } from 'vue'
import { parseIncrement } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import StatBox from '@/components/StatBox.vue'
import Modal from '@/components/ModalBox.vue'
import Button from '@/components/ButtonWidget.vue'

interface FormData {
  xp: { value: string }
}
interface InputSelect {
  select: () => void
}

const experienceModal = ref()
const character = inject(useKeys().characterKey) as Character
const { current: xpCurrent, max: xpMax } = character.xp

function updateExperience(input: string) {
  if (xpCurrent.value === undefined) return
  let newValue: number = parseIncrement(input, xpCurrent.value)
  newValue = Math.max(newValue, 0)
  xpCurrent.value = newValue
}
</script>
<template>
  <StatBox heading="Experience" @click="experienceModal.open()" class="cursor-pointer">
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
  </StatBox>
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
        <div class="mt-5 flex flex-row-reverse sm:mt-4">
          <Button type="submit" color="green" label="Update" />
        </div>
      </form>
    </Modal>
  </Teleport>
</template>
