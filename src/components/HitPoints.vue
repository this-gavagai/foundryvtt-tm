<script setup lang="ts">
// todo: loading indicator to communicate change in process? right now text just fades to white. Might seem non-responsive on slower connections
import type { Ref } from 'vue'
import type { Character } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import { useApi } from '@/composables/api'
import { parseIncrement } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import Statistic from '@/components/Statistic.vue'
import Modal from '@/components/Modal.vue'
import { useLastDamage } from '@/composables/lastDamage'

interface SubmissionEvent {
  submitter: { name: string }
}
interface FormData {
  hp: { value: string }
  temp_hp: { value: string }
}
interface InputSelect {
  select: () => void
}

const hpStat = ref()
const hitpointsModal = ref()

const character = inject(useKeys().characterKey) as Character
const { current: hpCurrent, max: hpMax, temp: hpTemp, modifiers: hpModifiers } = character.hp
const { lastDamageAmount } = useLastDamage()

function updateHitPoints(hp_input: string, temp_input: string) {
  if (hpCurrent.value === undefined || hpTemp.value === undefined || hpMax.value === undefined)
    return
  if (!temp_input) temp_input = '0'
  let newHP = parseIncrement(hp_input, hpCurrent.value)
  newHP = Math.max(Math.min(newHP, hpMax.value), 0)
  let newTemp = parseIncrement(temp_input, hpTemp.value)
  newTemp = Math.max(newTemp, 0)

  hpCurrent.value = newHP
  hpTemp.value = newTemp
}
</script>
<template>
  <Statistic
    heading="Hit Points"
    :subheading="`(Total Max: ${hpMax})`"
    @click="hitpointsModal.open()"
    ref="hpStat"
    :modifiers="hpModifiers"
    :preventInfoModal="true"
  >
    {{ hpCurrent ?? '??' }}
    <span v-if="hpTemp" class="text-blue-600">+ {{ hpTemp }}</span>
    <span v-else> / {{ hpMax ?? '??' }} </span>
  </Statistic>
  <Teleport to="#modals">
    <Modal
      ref="hitpointsModal"
      title="Hit Points"
      :infoButton="
        () => {
          hitpointsModal.close()
          hpStat.infoModal.open()
        }
      "
    >
      <form
        @submit.prevent="
          (e: Event) => {
            const event = e as Event & SubmissionEvent
            const { hp, temp_hp } = e.target as EventTarget & FormData
            if (event.submitter.name === 'update') updateHitPoints(hp.value, temp_hp.value)
            else if (event.submitter.name === 'reset') updateHitPoints(hpMax + '', '0')
            else if (event.submitter.name === 'lastDamageMinus') {
              const newTempHP = Math.max((hpTemp ?? 0) - lastDamageAmount, 0)
              const hpAdjustment = Math.max(lastDamageAmount - (hpTemp ?? 0), 0)
              updateHitPoints('-' + hpAdjustment, newTempHP + '')
            } else if (event.submitter.name === 'lastDamagePlus')
              updateHitPoints('+' + lastDamageAmount, hpTemp + '')
            hitpointsModal.close()
          }
        "
      >
        <div class="flex w-full items-center justify-center pb-1 pt-4">
          <div class="w-1/3">Standard:</div>
          <input
            class="ml-[32px] mr-4 w-1/3 border-2 border-black p-1 text-right text-3xl"
            name="hp"
            type="input"
            pattern="[\+\-]{0,1}[0-9]*"
            :placeholder="hpCurrent + ''"
            :value="hpCurrent"
            @focus="
              (e: Event) => {
                const field = e.target as EventTarget & InputSelect
                field.select()
              }
            "
          />
          <div class="w-1/3 text-xl">/ {{ hpMax }}</div>
        </div>
        <div class="flex w-full items-center justify-center pb-4 pt-1">
          <div class="w-1/3">Temporary:</div>
          <input
            class="ml-[32px] mr-4 w-1/3 border-2 border-black p-1 text-right text-xl"
            name="temp_hp"
            type="input"
            pattern="[\+\-]{0,1}[0-9]*"
            :placeholder="hpTemp + ''"
            :value="hpTemp"
            @focus="
              (e: Event) => {
                const field = e.target as EventTarget & InputSelect
                field.select()
              }
            "
          />
          <div class="w-1/3"></div>
        </div>
        <div class="mt-5 gap-1 sm:mt-4 sm:flex sm:flex-row-reverse">
          <button
            type="submit"
            name="update"
            class="inline-flex w-full justify-center bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto"
          >
            Update
          </button>
          <button
            type="submit"
            name="reset"
            class="inline-flex w-full justify-center bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500 sm:ml-3 sm:w-auto"
          >
            Reset HP
          </button>
          <div v-if="lastDamageAmount > 0">
            <button
              type="submit"
              name="lastDamageMinus"
              class="inline-flex w-1/2 justify-center bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto"
            >
              -{{ lastDamageAmount }}
            </button>
            <button
              type="submit"
              name="lastDamagePlus"
              class="inline-flex w-1/2 justify-center bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 sm:ml-3 sm:w-auto"
            >
              +{{ lastDamageAmount }}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  </Teleport>
</template>
