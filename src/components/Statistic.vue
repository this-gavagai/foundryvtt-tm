<script setup lang="ts">
import { ref } from 'vue'
import { SignedNumber } from '@/utils/utilities'
import { proficiencies } from '@/utils/constants'
import InfoModal from './InfoModal.vue'
import Modal from './Modal.vue'

const props = defineProps([
  'heading',
  'proficiency',
  'modifiers',
  'preventInfoModal',
  'allowRoll',
  'rollAction'
])
const infoModal = ref()

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
        class="text-[0.8rem] uppercase whitespace-nowrap"
        :class="proficiencies[props.proficiency]?.color"
      >
        {{ heading }}
      </div>
      <div class="text-lg">
        <slot></slot>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal ref="infoModal">
        <template #default>
          <div>
            <h3 class="text-xl mb-2">
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
                v-for="mod in props.modifiers.filter((m: any) => m.enabled || !m.hideIfDisabled)"
                class="flex gap-2"
                :class="{ 'text-gray-300': !mod.enabled }"
              >
                <div class="w-8 text-right">
                  {{ SignedNumber.format(mod.modifier) }}
                </div>
                <div class="whitespace-nowrap overflow-hidden text-ellipsis">{{ mod.label }}</div>
              </li>
            </ul>
          </div>
        </template>
        <template #actionButtons>
          <button
            v-if="allowRoll"
            type="button"
            class="bg-blue-600 hover:bg-blue-500 text-white inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium focus:outline-none"
            @click="
              () => {
                rollAction().then((r: any) => {
                  infoModal.rollResultModal.open(r)
                  infoModal.close()
                })
              }
            "
          >
            Roll
          </button>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
