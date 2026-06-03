<script setup lang="ts">
import { ref, computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import StatBox from './widgets/StatBox.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { parseIncrement, selectAllOnClick } from '@/utils/utilities'
import { runMacro } from '@/api/actions'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import Modal from './ModalBox.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import shield from '@/assets/icons/shield-2.svg'

interface SubmissionEvent {
  submitter: { name: string }
}
interface FormData {
  hp: { value: string }
}

const character = useInjectedCharacter()
const { _id: characterId, _actor, effects } = character
const { hardness, ac: shAC, itemId: shItemId } = character.shield
const { current: shpCurrent, max: shpMax, brokenThreshold: shpBT } = character.shield.hp

const { isListening } = storeToRefs(useListenersStore())
const shpModal = ref()
const shieldWaiting = ref(false)

const raisedShield = computed(
  () => effects.value?.find((e) => e?.system?.slug === 'effect-raise-a-shield') !== undefined
)

function updateHitPoints(hp_input: string) {
  if (shpCurrent.value === undefined || shpMax.value === undefined) return
  let newHP = parseIncrement(hp_input, shpCurrent.value)
  newHP = Math.max(Math.min(newHP, shpMax.value), 0)
  shpCurrent.value = newHP
}

// UUID of PF2e's "Raise a Shield" compendium macro. Hardcoded because raise-a-
// shield isn't registered in pf2e's new `game.pf2e.actions` Collection (it
// lives in the legacy function block of set-game-pf2e.ts), so we can't dispatch
// it via the slug-based `characterAction` route. The ID is stable in the
// compendium pack source — if pf2e ever moves the macro, this needs to follow.
const RAISE_A_SHIELD_MACRO_UUID = 'Compendium.pf2e.action-macros.Macro.4hfQEMiEOBbqelAh'

function raiseShield() {
  if (!isListening.value || !_actor.value) return
  shieldWaiting.value = true
  runMacro(_actor as Ref<CharacterPF2e>, RAISE_A_SHIELD_MACRO_UUID).then(() => {
    shieldWaiting.value = false
  })
}

function handleShpFormSubmit(e: Event) {
  const event = e as Event & SubmissionEvent
  const { hp } = e.target as EventTarget & FormData
  if (event.submitter.name === 'update') updateHitPoints(hp.value)
  else if (event.submitter.name === 'reset') updateHitPoints(shpMax.value + '')
  shpModal.value.close()
}
</script>
<template>
  <div v-if="shItemId">
    <div class="my-auto flex grow justify-between gap-4">
      <StatBox
        :heading="$t('ac.shieldHpHeading')"
        :subheading="$t('hp.totalMax', { max: shpMax })"
        class="cursor-pointer"
        :preventInfoModal="true"
        @click="shpModal.open()"
      >
        {{ shpCurrent ?? '??' }}
        <span> / {{ shpMax ?? '??' }} </span>
      </StatBox>
      <div>
        <div class="flex justify-between text-[.65rem]">
          <div class="pr-2">{{ $t('ac.acBonusLabel') }}</div>
          <div>{{ shAC }}</div>
        </div>
        <div class="flex justify-between text-[.65rem]">
          <div class="pr-2">{{ $t('ac.hardnessLabel') }}</div>
          <div>{{ hardness }}</div>
        </div>
        <div
          class="flex justify-between text-[.65rem]"
          :class="[(shpBT ?? 0) >= (shpCurrent ?? 0) ? 'text-red-600' : '']"
        >
          <div class="pr-2">{{ $t('ac.brokenAtLabel') }}</div>
          <div>{{ shpBT }}</div>
        </div>
      </div>
      <div
        @click="raiseShield"
        class="cursor-pointer transition-all"
        :class="[
          raisedShield ? 'active:opacity-40' : 'opacity-20 active:opacity-10',
          shieldWaiting ? 'animate-pulse opacity-10' : '',
          (shpBT ?? 0) >= (shpCurrent ?? 0) || !isListening ? 'opacity-0!' : ''
        ]"
      >
        <img :src="shield" class="mt-2 h-8 w-8" />
      </div>
    </div>

    <Teleport to="#modals">
      <Modal ref="shpModal" :title="$t('ac.shieldModal')">
        <form @submit.prevent="handleShpFormSubmit">
          <div class="flex w-full items-center justify-center pt-4 pb-1">
            <div class="w-1/3">{{ $t('ac.hitPointsLabel') }}</div>
            <input
              class="mr-4 ml-[32px] w-1/3 border-2 border-black p-1 text-right text-3xl selection:bg-blue-700 selection:text-white"
              name="hp"
              type="input"
              pattern="[\+\-]{0,1}[0-9]*"
              :placeholder="shpCurrent + ''"
              :value="shpCurrent"
              @click="selectAllOnClick"
            />
            <div class="w-1/3 text-xl">/ {{ shpMax }}</div>
          </div>
          <div class="mt-5 flex flex-row-reverse flex-wrap-reverse gap-1 sm:mt-4">
            <Button type="submit" name="update" :label="$t('common.update')" color="blue" />
            <Button type="submit" name="reset" :label="$t('hp.reset')" color="gray" />
          </div>
        </form>
      </Modal>
    </Teleport>
  </div>
</template>
