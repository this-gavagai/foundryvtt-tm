<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject, ref, computed } from 'vue'
import { useApi } from '@/composables/api'
import { parseIncrement } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import Statistic from '@/components/Statistic.vue'
import Modal from '@/components/Modal.vue'

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

const actor = inject(useKeys().actorKey)!
const world = inject(useKeys().worldKey)!
const hitpointsModal = ref()
const hpStat = ref()
const focusTarget = ref(null)

const { updateActor } = useApi()

function updateHitPoints(hp_input: string, temp_input: string) {
  let newHP = parseIncrement(hp_input, actor.value?.system?.attributes.hp.value)
  newHP = Math.max(Math.min(newHP, actor.value?.system?.attributes.hp.max), 0)
  actor.value!.system.attributes.hp.value = newHP

  let newTemp = parseIncrement(temp_input, actor.value?.system?.attributes.hp.temp)
  newTemp = Math.max(newTemp, 0)
  actor.value!.system.attributes.hp.temp = newTemp

  setTimeout(() => {
    if (actor.value !== undefined)
      updateActor(
        actor as Ref<Actor>,
        { system: { attributes: { hp: { value: newHP, temp: newTemp } } } },
        null
      )
  }, 3000)
}

const lastDamageAmount = computed(() => {
  const lastMessage = world.value?.messages?.slice(-1)?.[0]
  const lastRoll = lastMessage?.rolls?.[0]
  if (lastRoll && JSON.parse(lastRoll)?.class === 'DamageRoll') {
    return JSON.parse(lastRoll)?.total
  } else {
    return 0
  }
})
</script>
<template>
  <Statistic
    heading="Hit Points"
    @click="hitpointsModal.open()"
    ref="hpStat"
    :modifiers="actor?.system?.attributes?.hp._modifiers"
    :preventInfoModal="true"
  >
    {{ actor?.system?.attributes.hp.value ?? '??' }}
    <span v-if="actor?.system?.attributes.hp.temp" class="text-blue-600"
      >+ {{ actor?.system?.attributes.hp.temp }}</span
    >
    <span v-if="!actor?.system?.attributes.hp.temp">
      / {{ actor?.system?.attributes.hp.max ?? '??' }}
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
          (e: Event) => {
            const event = e as Event & SubmissionEvent
            const { hp, temp_hp } = e.target as EventTarget & FormData
            if (event.submitter.name === 'update') updateHitPoints(hp.value, temp_hp.value)
            else if (event.submitter.name === 'reset')
              updateHitPoints(actor?.system?.attributes.hp.max + '', '0')
            else if (event.submitter.name === 'lastDamageMinus') {
              const newTempHP = Math.max(actor?.system?.attributes.hp.temp - lastDamageAmount, 0)
              const hpAdjustment = Math.max(lastDamageAmount - actor?.system?.attributes.hp.temp, 0)
              updateHitPoints('-' + hpAdjustment, newTempHP + '')
            } else if (event.submitter.name === 'lastDamagePlus')
              updateHitPoints('+' + lastDamageAmount, actor?.system?.attributes.hp.temp + '')
            hitpointsModal.close()
          }
        "
      >
        <div class="flex w-full items-center justify-center pb-1 pt-4">
          <div class="w-1/3">Standard:</div>
          <input
            ref="focusTarget"
            class="ml-[32px] mr-4 w-1/3 border-2 border-black p-1 text-right text-3xl"
            name="hp"
            type="input"
            pattern="[\+\-]{0,1}[0-9]*"
            :placeholder="actor?.system?.attributes.hp.value"
            :value="actor!.system.attributes.hp.value"
            @focus="
              (e: Event) => {
                const field = e.target as EventTarget & InputSelect
                field.select()
              }
            "
          />
          <div class="w-1/3 text-xl">/ {{ actor?.system?.attributes.hp.max }}</div>
        </div>
        <div class="flex w-full items-center justify-center pb-4 pt-1">
          <div class="w-1/3">Temporary:</div>
          <input
            class="ml-[32px] mr-4 w-1/3 border-2 border-black p-1 text-right text-xl"
            name="temp_hp"
            type="input"
            pattern="[\+\-]{0,1}[0-9]*"
            :placeholder="actor?.system?.attributes.hp.temp"
            :value="actor!.system.attributes.hp.temp"
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
@/composables/api@/composables@/types/pf2e-types
