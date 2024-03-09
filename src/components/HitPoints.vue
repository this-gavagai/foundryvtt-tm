<script setup lang="ts">
import { inject, ref } from 'vue'
import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

import Statistic from '@/components/Statistic.vue'
import Modal from '@/components/Modal.vue'

const actor: any = inject('actor')
const hitpointsModal = ref()

const { socket } = useServer()

function updateHitPoints(input: String) {
  const transform = [...input.matchAll(/([+-]){0,1}([0-9]+)$/g)]?.[0]
  if (!transform) return

  let newValue: number
  if (transform[1] === '+') {
    newValue = actor.value.system?.attributes.hp.value + (Number(transform[2]) ?? 0)
  } else if (transform[1] === '-') {
    newValue = actor.value.system?.attributes.hp.value - (Number(transform[2]) ?? 0)
  } else {
    newValue = Number(transform[2]) ?? actor.value.system?.attributes.hp.value
  }
  newValue = Math.max(Math.min(newValue, actor.value.system?.attributes.hp.max), 0)

  console.log(newValue)
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
            attributes: {
              hp: {
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
  <Statistic heading="Hit Points" @click="hitpointsModal.open()">
    {{ actor.system?.attributes.hp.value ?? '??' }} /
    {{ actor.system?.attributes.hp.max ?? '??' }}
  </Statistic>
  <Teleport to="#modals">
    <Modal ref="hitpointsModal" title="Hit Points">
      <form
        @submit.prevent="
          (e: any) => {
            updateHitPoints(e.target[0].value)
            hitpointsModal.close()
          }
        "
      >
        <div class="w-full py-8 text-3xl flex justify-center items-center">
          <input
            class="text-3xl border-2 border-black w-24 p-1 mr-4 text-right ml-[42px]"
            name="hp"
            :placeholder="actor.system?.attributes.hp.value"
            @focus="(e: any) => e.target.select()"
            focus-target
          />
          <span class="text-xl">/ {{ actor.system?.attributes.hp.max }}</span>
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
    </Modal>
  </Teleport>
</template>
