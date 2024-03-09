<script setup lang="ts">
import { inject, ref } from 'vue'
import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

import Statistic from '@/components/Statistic.vue'
import Counter from '@/components/Counter.vue'
import Modal from '@/components/Modal.vue'

import { PlusCircleIcon, MinusCircleIcon } from '@heroicons/vue/24/outline'

const actor: any = inject('actor')
const heropointsModal = ref()

const { socket } = useServer()

function updateHeroPoints(change: Number) {
  const newTotal = actor.value.system?.resources.heroPoints.value + change
  if (newTotal > actor.value.system?.resources.heroPoints.max || newTotal < 0) return
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
            resources: {
              heroPoints: {
                value: actor.value.system?.resources.heroPoints.value + change
              }
            }
          }
        }
      ]
    },
    (r: any) => {
      console.log(r)
      r.result.forEach((change: any) => {
        mergeDeep(actor.value, change)
      })
    }
  )
}
</script>
<template>
  <Statistic heading="Hero Pts" @click="heropointsModal.open()">
    <Counter
      :value="actor.system?.resources.heroPoints.value ?? '0'"
      :max="actor.system?.resources.heroPoints.max ?? '0'"
    />
  </Statistic>
  <Teleport to="#modals">
    <Modal ref="heropointsModal" title="Hero Points">
      <div class="w-full py-8 text-3xl flex justify-center">
        <button class="text-gray-500" @click="updateHeroPoints(-1)">
          <MinusCircleIcon class="h-6 w-6" />
        </button>
        <Counter
          class="px-2"
          :value="actor.system?.resources.heroPoints.value ?? '0'"
          :max="actor.system?.resources.heroPoints.max ?? '0'"
        />
        <button class="text-gray-500" @click="updateHeroPoints(+1)">
          <PlusCircleIcon class="h-6 w-6" />
        </button>
      </div>
    </Modal>
  </Teleport>
</template>
