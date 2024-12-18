<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Character } from '@/composables/character'
import { inject } from 'vue'
import StatBox from './StatBox.vue'
import { useKeys } from '@/composables/injectKeys'
import { parseIncrement } from '@/utils/utilities'
import { useApi } from '@/composables/api'

import Modal from './ModalBox.vue'
import Button from '@/components/ButtonWidget.vue'
import shield from '@/assets/icons/armor-upgrade.svg'

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

const shieldWaiting = ref(false)

const shpModal = ref()

const character = inject(useKeys().characterKey) as Character
const { _id: characterId, effects } = character
const { current: acCurrent, modifiers: acModifiers } = character.ac
const { hardness, ac: shAC } = character.shield
const { current: shpCurrent, max: shpMax, brokenThreshold: shpBT } = character.shield.hp

const { callMacro } = useApi()

const raisedShield = computed(
  () => effects.value?.find((e) => e?.system?.slug === 'effect-raise-a-shield') !== undefined
)

function updateHitPoints(hp_input: string) {
  if (shpCurrent.value === undefined || shpMax.value === undefined) return
  let newHP = parseIncrement(hp_input, shpCurrent.value)
  newHP = Math.max(Math.min(newHP, shpMax.value), 0)
  shpCurrent.value = newHP
}
</script>
<template>
  <div class="flex justify-between gap-4 border-b px-6 py-4">
    <StatBox heading="AC" :modifiers="acModifiers" class="">
      <div class="w-8">
        {{ acCurrent ?? '??' }}
      </div>
    </StatBox>
    <div class="border border-gray-200"></div>
    <div v-if="!shAC" class="my-auto grow">
      <div class="italic">No shield equipped</div>
    </div>
    <div v-else class="my-auto flex grow justify-between gap-4">
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
      <div
        @click="
          () => {
            shieldWaiting = true
            callMacro(characterId, 'pf2e.action-macros', 'Raise a Shield').then((a) => {
              shieldWaiting = false
            })
          }
        "
        class="cursor-pointer"
        :class="[
          raisedShield ? 'text-green-600 active:opacity-40' : 'opacity-20 active:opacity-10',
          shieldWaiting ? 'animate-pulse opacity-10' : ''
        ]"
      >
        <!-- <ShieldCheckIcon class="mt-2 h-8 w-8" /> -->
        <img :src="shield" class="mt-2 h-8 w-8" />
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
        <div class="mt-5 flex flex-row-reverse flex-wrap-reverse gap-1 sm:mt-4">
          <Button type="submit" name="update" label="Update" color="blue" />
          <Button type="submit" name="reset" label="Reset HP" />
        </div>
      </form>
    </Modal>
  </Teleport>
</template>
