<script setup lang="ts">
import { ref } from 'vue'
import { parseIncrement, selectAllOnClick } from '@/utils/utilities'
import { useInjectedActor } from '@/composables/injectKeys'

import StatBox from '@/components/widgets/StatBox.vue'
import Modal from '@/components/ModalBox.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import { useLastDamage } from '@/composables/useLastDamage'
import { applyDamage } from '@/api/actionRpc'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'

interface SubmissionEvent {
  submitter: { name: string }
}
interface FormData {
  hp: { value: string }
  temp_hp: { value: string }
}

const hpStat = ref()
const hitpointsModal = ref()

const character = useInjectedActor()
const { current: hpCurrent, max: hpMax, temp: hpTemp, modifiers: hpModifiers } = character.hp
const { _actor } = character
const { lastDamageAmount, lastDamageMessageId } = useLastDamage()
// Typing hit points into the field beside these falls back to a direct write
// with no GM (composables/setHitPoints), but these two buttons cannot: applying
// a card's damage is PF2e's own IWR pass on the GM's client. Fire-and-forget
// with the modal closing behind it, an ungated tap did nothing at all and said
// nothing about it — so they are hidden instead, and the field still works.
const { isListening } = storeToRefs(useListenersStore())

// One call, not two: the write happens on the GM's client (see
// composables/setHitPoints.ts) so the `preUpdateActor` hooks that drive HP
// automation run, and a module deciding whether this edit crossed 0 has to see
// hit points and temporary hit points together. Fields the form left unchanged
// are omitted so the GM side leaves them alone.
function updateHitPoints(hp_input: string, temp_input: string) {
  if (hpCurrent.value === undefined || hpTemp.value === undefined || hpMax.value === undefined)
    return
  if (!temp_input) temp_input = '0'
  let newHP = parseIncrement(hp_input, hpCurrent.value)
  newHP = Math.max(Math.min(newHP, hpMax.value), 0)
  let newTemp = parseIncrement(temp_input, hpTemp.value)
  newTemp = Math.max(newTemp, 0)

  // Fire-and-forget: recovery (refresh + rethrow) happens inside the write.
  void character.hp
    .set({
      ...(newHP !== hpCurrent.value ? { value: newHP } : {}),
      ...(newTemp !== hpTemp.value ? { temp: newTemp } : {})
    })
    .catch(() => {})
}

function handleHpFormSubmit(e: Event) {
  const event = e as Event & SubmissionEvent
  const { hp, temp_hp } = e.target as EventTarget & FormData
  switch (event.submitter.name) {
    case 'update':
      updateHitPoints(hp.value, temp_hp.value)
      break
    case 'reset':
      updateHitPoints(hpMax.value + '', '0')
      break
    case 'lastDamageMinus':
      if (lastDamageMessageId.value) applyDamage(_actor, lastDamageMessageId.value, 'damage', 0)
      break
    case 'lastDamagePlus':
      if (lastDamageMessageId.value) applyDamage(_actor, lastDamageMessageId.value, 'heal', 0)
      break
  }
  hitpointsModal.value.close()
}

function openInfoFromHpModal() {
  hitpointsModal.value.close()
  hpStat.value.infoModal.open()
}
</script>
<template>
  <div>
    <StatBox
      :heading="$t('hp.heading')"
      :subheading="$t('hp.totalMax', { max: hpMax })"
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
      <Modal ref="hitpointsModal" :title="$t('hp.heading')" :infoButton="openInfoFromHpModal">
        <form @submit.prevent="handleHpFormSubmit">
          <div class="flex w-full items-center justify-center pt-4 pb-1">
            <div class="w-1/3">{{ $t('hp.standard') }}</div>
            <input
              class="mr-4 ml-[32px] w-1/3 border-2 border-black p-1 text-right text-3xl selection:bg-blue-700 selection:text-white"
              name="hp"
              type="input"
              pattern="[\+\-]{0,1}[0-9]*"
              :placeholder="hpCurrent + ''"
              :value="hpCurrent"
              inputmode="numeric"
              @click="selectAllOnClick"
            />
            <div class="w-1/3 text-xl">/ {{ hpMax }}</div>
          </div>
          <div class="flex w-full items-center justify-center pt-1 pb-4">
            <div class="w-1/3">{{ $t('hp.temporary') }}</div>
            <input
              class="mr-4 ml-[32px] w-1/3 border-2 border-black p-1 text-right text-3xl selection:bg-blue-700 selection:text-white"
              name="temp_hp"
              type="input"
              pattern="[\+\-]{0,1}[0-9]*"
              :placeholder="hpTemp + ''"
              :value="hpTemp"
              inputmode="numeric"
              @click="selectAllOnClick"
            />
            <div class="w-1/3"></div>
          </div>
          <div class="mt-5 flex flex-row-reverse flex-wrap-reverse gap-1 sm:mt-4">
            <Button type="submit" name="update" :label="$t('common.update')" color="blue" />
            <Button type="submit" name="reset" color="gray" :label="$t('hp.reset')" />
            <span class="flex gap-1">
              <Button
                type="submit"
                name="lastDamageMinus"
                color="red"
                :label="'-' + lastDamageAmount"
                v-if="lastDamageAmount > 0 && isListening"
              />
              <Button
                type="submit"
                name="lastDamagePlus"
                :label="'+' + lastDamageAmount"
                color="green"
                v-if="lastDamageAmount > 0 && isListening"
              />
            </span>
          </div>
        </form>
      </Modal>
    </Teleport>
  </div>
</template>
