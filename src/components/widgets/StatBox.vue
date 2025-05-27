<script setup lang="ts">
import { ref, computed } from 'vue'
import { SignedNumber } from '@/utils/utilities'
import { proficiencies } from '@/utils/constants'
import InfoModal from '@/components/InfoModal.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import type { RollResult } from '@/types/pf2e-types'
import { useListeners } from '@/composables/listenersOnline'
import type { Modifier } from '@/composables/character'

const props = defineProps<{
  heading?: string
  subheading?: string
  fullHeading?: string
  modalHeading?: string
  proficiency?: number
  modifiers?: Modifier[] | undefined
  breakdown?: string
  preventInfoModal?: boolean
  rollAction?: (r: number | undefined) => Promise<RollResult | null>
}>()
const infoModal = ref()
const { isListening } = useListeners()

function makeRoll(result: number | undefined = undefined) {
  return props.rollAction?.(result).then((r: RollResult | null) => {
    infoModal.value.rollResultModal.open(r)
    infoModal.value.close()
  })
}
const canOpen = computed(() => (props?.modifiers || props?.breakdown) && !props.preventInfoModal)

defineExpose({ infoModal })
</script>
<template>
  <div :data-proficiency-level="proficiency" :data-has-details="canOpen">
    <div
      class="fit-content"
      :class="{
        'active:drop-shadow-glow cursor-pointer': canOpen
      }"
      @click="
        () => {
          if (canOpen) infoModal.open()
        }
      "
    >
      <div
        :class="proficiencies[props.proficiency ?? 0]?.color"
        class="text-[0.8rem] whitespace-nowrap uppercase"
      >
        {{ heading }}
      </div>
      <div class="text-lg whitespace-nowrap">
        <slot></slot>
      </div>
      <div class="hidden whitespace-nowrap uppercase">{{ fullHeading }}</div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :diceRequest="rollAction ? ['d20'] : undefined"
        @diceResult="
          (face) => {
            if (rollAction && isListening) makeRoll(face)
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
                  (m: Modifier) => m.enabled || !m.hideIfDisabled
                )"
                class="flex gap-2"
                :class="{ 'text-gray-300': !mod.enabled }"
                :key="'mod_' + mod.slug"
              >
                <div class="w-8 text-right">
                  {{ SignedNumber.format(mod.modifier ?? 0) }}
                </div>
                <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
              </li>
            </ul>
          </div>
        </template>
        <template #actionButtons v-if="isListening">
          <Button v-if="props.rollAction" color="blue" label="Roll" :clicked="() => makeRoll()" />
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
