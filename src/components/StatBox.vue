<script setup lang="ts">
import { ref, computed } from 'vue'
import { SignedNumber } from '@/utils/utilities'
import { proficiencies } from '@/utils/constants'
import InfoModal from './InfoModal.vue'
import Button from '@/components/ButtonWidget.vue'
import type { StatModifier, RollResult } from '@/types/pf2e-types'

const props = defineProps([
  'heading',
  'subheading',
  'modalHeading',
  'proficiency',
  'modifiers',
  'breakdown',
  'preventInfoModal',
  'rollAction'
])
const infoModal = ref()

function makeRoll(result: number | undefined = undefined) {
  return props.rollAction(result).then((r: RollResult) => {
    infoModal.value.rollResultModal.open(r)
    infoModal.value.close()
  })
}
const canOpen = computed(() => (props?.modifiers || props?.breakdown) && !props.preventInfoModal)

defineExpose({ infoModal })
</script>
<template>
  <div>
    <div
      class="fit-content"
      :class="{
        'cursor-pointer active:drop-shadow-glow': canOpen
      }"
      @click="
        () => {
          if (canOpen) infoModal.open()
        }
      "
    >
      <div
        :class="proficiencies[props.proficiency]?.color"
        class="whitespace-nowrap text-[0.8rem] uppercase"
      >
        {{ heading }}
      </div>
      <div class="whitespace-nowrap text-lg">
        <slot></slot>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :diceRequest="rollAction ? ['d20'] : undefined"
        @diceResult="
          (face) => {
            if (rollAction) makeRoll(face)
          }
        "
      >
        <template #default>
          <div>
            <h3 class="mb-2 text-xl">
              {{ modalHeading ?? heading }}
              <span
                v-if="props.proficiency"
                :class="proficiencies[props.proficiency].color"
                class="text-sm"
              >
                ({{ proficiencies[props.proficiency].label }})
              </span>
            </h3>
            <h4 class="text-l mb-2">{{ subheading }}</h4>
            <div>{{ props?.breakdown }}</div>
            <ul>
              <li
                v-for="mod in props?.modifiers?.filter(
                  (m: StatModifier) => m.enabled || !m.hideIfDisabled
                )"
                class="flex gap-2"
                :class="{ 'text-gray-300': !mod.enabled }"
                :key="'mod_' + mod.slug"
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
          <Button v-if="props.rollAction" color="blue" label="Roll" :clicked="() => makeRoll()" />
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
