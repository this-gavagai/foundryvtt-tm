<script setup lang="ts">
//TODO (feature): add raise shield and shield block macros in a convenient way; need macro component first
import { ref } from 'vue'
import type { Character } from '@/composables/character'
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { useKeys } from '@/composables/injectKeys'
import { parseIncrement } from '@/utils/utilities'

import Modal from './ModalBox.vue'
import Button from '@/components/ButtonWidget.vue'

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

const shpModal = ref()

const character = inject(useKeys().characterKey) as Character
const { current: acCurrent, modifiers: acModifiers } = character.ac
const { hardness, ac: shAC } = character.shield
const { current: shpCurrent, max: shpMax, brokenThreshold: shpBT } = character.shield.hp

function updateHitPoints(hp_input: string) {
  if (shpCurrent.value === undefined || shpMax.value === undefined) return
  let newHP = parseIncrement(hp_input, shpCurrent.value)
  newHP = Math.max(Math.min(newHP, shpMax.value), 0)
  shpCurrent.value = newHP
}
</script>
<template>
  <div class="flex gap-4 border-b px-6 py-4">
    <StatBox heading="AC" :modifiers="acModifiers" class="">
      <div class="w-8">
        {{ acCurrent ?? '??' }}
      </div>
    </StatBox>
    <div class="border border-gray-200"></div>
    <div v-if="!shAC" class="my-auto">
      <div class="italic">No shield equipped</div>
    </div>
    <div v-else class="my-auto flex gap-6">
      <StatBox
        heading="Shield HP"
        :subheading="`(Total Max: ${shpMax})`"
        ref="hpStat"
        class="cursor-pointer"
        :preventInfoModal="true"
        @click="shpModal.open()"
      >
        {{ shpCurrent ?? '??' }}
        <span> / {{ shpMax ?? '??' }} </span>
      </StatBox>
      <div>
        <div class="flex justify-between text-[.65rem]">
          <div class="pr-2">AC Bonus:</div>
          <div>{{ shAC }}</div>
        </div>
        <div class="flex justify-between text-[.65rem]">
          <div class="pr-2">Hardness:</div>
          <div>{{ hardness }}</div>
        </div>
        <div class="flex justify-between text-[.65rem]">
          <div class="pr-2">Broken at:</div>
          <div>{{ shpBT }}</div>
        </div>
      </div>
    </div>
  </div>
  <Teleport to="#modals">
    <Modal
      ref="shpModal"
      title="Shield"
      :infoButton="
        () => {
          console.log('shield info')
        }
      "
    >
      <form
        @submit.prevent="
          (e: Event) => {
            const event = e as Event & SubmissionEvent
            const { hp } = e.target as EventTarget & FormData
            if (event.submitter.name === 'update') updateHitPoints(hp.value)
            else if (event.submitter.name === 'reset') updateHitPoints(shpMax + '')
            shpModal.close()
          }
        "
      >
        <div class="flex w-full items-center justify-center pb-1 pt-4">
          <div class="w-1/3">Hit Points:</div>
          <input
            class="ml-[32px] mr-4 w-1/3 border-2 border-black p-1 text-right text-3xl"
            name="hp"
            type="input"
            pattern="[\+\-]{0,1}[0-9]*"
            :placeholder="shpCurrent + ''"
            :value="shpCurrent"
            @focus="
              (e: Event) => {
                const field = e.target as EventTarget & InputSelect
                field.select()
              }
            "
          />
          <div class="w-1/3 text-xl">/ {{ shpMax }}</div>
        </div>
        <div class="mt-5 gap-1 sm:mt-4 sm:flex sm:flex-row-reverse">
          <Button
            type="submit"
            name="update"
            label="Update"
            color="blue"
            class="inline-flex w-full justify-center bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto"
          />
          <Button
            type="submit"
            name="reset"
            label="Reset HP"
            class="inline-flex w-full justify-center bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500 sm:ml-3 sm:w-auto"
          />
        </div>
      </form>
    </Modal>
  </Teleport>
</template>
