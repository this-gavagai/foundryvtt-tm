<script setup lang="ts">
import type { Character } from '@/composables/character'
import { inject, ref } from 'vue'
import { parseIncrement } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import StatBox from '@/components/widgets/StatBox.vue'
import Modal from '@/components/ModalBox.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import { useLastDamage } from '@/composables/lastDamage'

interface SubmissionEvent {
  submitter: { name: string }
}
interface FormData {
  hp: { value: string }
  temp_hp: { value: string }
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
  <div>
    <StatBox
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
    </StatBox>
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
          <div class="flex w-full items-center justify-center pt-4 pb-1">
            <div class="w-1/3">Standard:</div>
            <input
              class="mr-4 ml-[32px] w-1/3 border-2 border-black p-1 text-right text-3xl selection:bg-blue-700 selection:text-white"
              name="hp"
              type="input"
              pattern="[\+\-]{0,1}[0-9]*"
              :placeholder="hpCurrent + ''"
              :value="hpCurrent"
              inputmode="numeric"
              @click="
                (e: Event) => {
                  const field = e.target as HTMLInputElement
                  field.focus()
                  field.select()
                }
              "
            />
            <div class="w-1/3 text-xl">/ {{ hpMax }}</div>
          </div>
          <div class="flex w-full items-center justify-center pt-1 pb-4">
            <div class="w-1/3">Temporary:</div>
            <input
              class="mr-4 ml-[32px] w-1/3 border-2 border-black p-1 text-right text-3xl selection:bg-blue-700 selection:text-white"
              name="temp_hp"
              type="input"
              pattern="[\+\-]{0,1}[0-9]*"
              :placeholder="hpTemp + ''"
              :value="hpTemp"
              inputmode="numeric"
              @click="
                (e: Event) => {
                  const field = e.target as HTMLInputElement
                  field.focus()
                  field.select()
                }
              "
            />
            <div class="w-1/3"></div>
          </div>
          <div class="mt-5 flex flex-row-reverse flex-wrap-reverse gap-1 sm:mt-4">
            <Button type="submit" name="update" label="Update" color="blue" />
            <Button type="submit" name="reset" color="gray" label="Reset HP" />
            <span class="flex gap-1">
              <Button
                type="submit"
                name="lastDamageMinus"
                color="red"
                :label="'-' + lastDamageAmount"
                v-if="lastDamageAmount > 0"
              />
              <Button
                type="submit"
                name="lastDamagePlus"
                :label="'+' + lastDamageAmount"
                color="green"
                v-if="lastDamageAmount > 0"
              />
            </span>
          </div>
        </form>
      </Modal>
    </Teleport>
  </div>
</template>
