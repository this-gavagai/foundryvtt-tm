<script setup lang="ts">
import { inject, ref } from 'vue'
import { updateActor } from '@/utils/api'
import { parseIncrement } from '@/utils/utilities'

import Statistic from '@/components/Statistic.vue'
import Modal from '@/components/Modal.vue'

const actor: any = inject('actor')
const hitpointsModal = ref()
const hpStat = ref()
const focusTarget = ref(null)

function updateHitPoints(hp_input: string, temp_input: string) {
  let newHP = parseIncrement(hp_input, actor.value.system?.attributes.hp.value)
  newHP = Math.max(Math.min(newHP, actor.value.system?.attributes.hp.max), 0)

  let newTemp = parseIncrement(temp_input, actor.value.system?.attributes.hp.temp)
  newTemp = Math.max(newTemp, 0)

  updateActor(actor, { system: { attributes: { hp: { value: newHP, temp: newTemp } } } }, null)
}
</script>
<template>
  <Statistic
    heading="Hit Points"
    @click="hitpointsModal.open()"
    ref="hpStat"
    :modifiers="actor.system?.attributes?.hp._modifiers"
    :preventInfoModal="true"
  >
    {{ actor.system?.attributes.hp.value ?? '??' }}
    <span v-if="actor.system?.attributes.hp.temp" class="text-blue-600"
      >+ {{ actor.system?.attributes.hp.temp }}</span
    >
    <span v-if="!actor.system?.attributes.hp.temp">
      / {{ actor.system?.attributes.hp.max ?? '??' }}
    </span>
  </Statistic>
  <Teleport to="#modals">
    <Modal
      ref="hitpointsModal"
      title="Hit Points"
      :focusTarget="focusTarget"
      :infoButton="
        () => {
          hitpointsModal.close()
          hpStat.infoModal.open()
        }
      "
    >
      <form
        @submit.prevent="
          (e: any) => {
            updateHitPoints(e.target.elements.hp.value, e.target.elements.temp_hp.value)
            hitpointsModal.close()
          }
        "
      >
        <div class="w-full pt-4 pb-1 flex justify-center items-center">
          <div class="w-1/3">Standard:</div>
          <input
            ref="focusTarget"
            class="text-3xl border-2 border-black w-1/3 p-1 mr-4 text-right ml-[32px]"
            name="hp"
            type="number"
            pattern="[+-]{0,1}[0-9]*"
            :placeholder="actor.system?.attributes.hp.value"
            @focus="(e: any) => e.target.select()"
          />
          <div class="text-xl w-1/3">/ {{ actor.system?.attributes.hp.max }}</div>
        </div>
        <div class="w-full pb-4 pt-1 flex justify-center items-center">
          <div class="w-1/3 text-blue-600">Temporary:</div>
          <input
            class="text-xl border-2 border-black text-blue-600 w-1/3 p-1 mr-4 text-right ml-[32px]"
            name="temp_hp"
            type="number"
            pattern="[+-]{0,1}[0-9]*"
            :placeholder="actor.system?.attributes.hp.temp"
            @focus="(e: any) => e.target.select()"
          />
          <div class="w-1/3"></div>
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
