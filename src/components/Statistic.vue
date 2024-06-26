<script setup lang="ts">
import { ref } from 'vue'
import { SignedNumber } from '@/utils/utilities'
import { proficiencies } from '@/utils/constants'
import InfoModal from './InfoModal.vue'
import Button from '@/components/Button.vue'
import type { StatModifier, RollResult } from '@/types/pf2e-types'

const props = defineProps([
  'heading',
  'proficiency',
  'modifiers',
  'preventInfoModal',
  'allowRoll',
  'rollAction'
])
const infoModal = ref()
const rollButton = ref()

function makeRoll() {
  rollButton.value.waiting = true
  // setTimeout(() => {
  props.rollAction().then((r: RollResult) => {
    infoModal.value.rollResultModal.open(r)
    infoModal.value.close()
    rollButton.value.waiting = false
  })
  // }, 3000)
}

defineExpose({ infoModal })
</script>
<template>
  <div>
    <div
      :class="{ 'cursor-pointer': props?.modifiers && !preventInfoModal }"
      @click="
        () => {
          if (props?.modifiers && !preventInfoModal) infoModal.open()
        }
      "
    >
      <!-- <Popover class="relative"> -->
      <!-- <PopoverButton> -->
      <div
        class="whitespace-nowrap text-[0.8rem] uppercase"
        :class="proficiencies[props.proficiency]?.color"
      >
        {{ heading }}
      </div>
      <div class="whitespace-nowrap text-lg">
        <slot></slot>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal ref="infoModal">
        <template #default>
          <div>
            <h3 class="mb-2 text-xl">
              {{ heading }}
              <span
                v-if="props.proficiency"
                :class="proficiencies[props.proficiency].color"
                class="text-sm"
              >
                ({{ proficiencies[props.proficiency].label }})
              </span>
            </h3>
            <ul>
              <li
                v-for="mod in props.modifiers.filter(
                  (m: StatModifier) => m.enabled || !m.hideIfDisabled
                )"
                class="flex gap-2"
                :class="{ 'text-gray-300': !mod.enabled }"
              >
                <div class="w-8 text-right">
                  {{ SignedNumber.format(mod.modifier) }}
                </div>
                <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
              </li>
            </ul>
          </div>
        </template>
        <template #actionButtons>
          <!-- <button
            v-if="allowRoll"
            type="button"
            class="inline-flex items-end justify-center border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none"
            @click="
              () => {
                rollAction().then((r: RollResult) => {
                  infoModal.rollResultModal.open(r)
                  infoModal.close()
                })
              }
            "
          >
            Roll
          </button> -->
          <Button
            v-if="allowRoll"
            ref="rollButton"
            type="button"
            class="bg-blue-600 text-white hover:bg-blue-500"
            label="Roll"
            @click="() => makeRoll()"
          />
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
