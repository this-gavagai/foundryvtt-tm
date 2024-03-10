<script setup lang="ts">
import { inject, ref } from 'vue'
import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

import Statistic from '@/components/Statistic.vue'
import EditValueModal from '@/components/Modal.vue'

const actor: any = inject('actor')
const experienceModal = ref()

const { socket } = useServer()

function updateExperience(input: String) {
  const transform = [...input.matchAll(/([+-]){0,1}([0-9]+)$/g)]?.[0]
  if (!transform) return

  let newValue: number
  if (transform[1] === '+') {
    newValue = Number(actor.value.system?.details.xp.value) + (Number(transform[2]) ?? 0)
  } else if (transform[1] === '-') {
    newValue = actor.value.system?.details.xp.value - (Number(transform[2]) ?? 0)
  } else {
    newValue = Number(transform[2]) ?? actor.value.system?.details.xp.value
  }
  newValue = Math.max(newValue, 0)

  socket.value.emit(
    'modifyDocument',
    {
      action: 'update',
      type: 'Actor',
      options: { diff: true, render: true },
      updates: [
        {
          _id: actor.value._id,
          system: {
            details: {
              xp: {
                value: newValue
              }
            }
          }
        }
      ]
    },
    (r: any) => {
      r.result.forEach((change: any) => {
        mergeDeep(actor.value, change)
      })
    }
  )
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
    <EditValueModal ref="experienceModal" title="Experience Points">
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
            focus-target
          />
        </div>
        <div class="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
          <button
            type="submit"
            class="inline-flex w-full justify-center rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 sm:ml-3 sm:w-auto"
          >
            Update
          </button>
        </div>
      </form>
    </EditValueModal>
  </Teleport>
</template>
