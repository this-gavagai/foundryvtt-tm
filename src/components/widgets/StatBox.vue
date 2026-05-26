<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignedNumber } from '@/utils/utilities'
import { proficiencyLevels } from '@/utils/constants'
import InfoModal from '@/components/InfoModal.vue'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Modifier } from '@/composables/character'

const { t } = useI18n()
const props = defineProps<{
  heading?: string
  subheading?: string
  fullHeading?: string
  modalHeading?: string
  proficiency?: number
  modifiers?: Modifier[] | undefined
  breakdown?: string
  preventInfoModal?: boolean
  rollAction?: (r: number | undefined) => Promise<RequestResolutionArgs | null>
}>()
const infoModal = ref()
const { isListening } = storeToRefs(useListenersStore())

const canOpen = computed(() => (props?.modifiers || props?.breakdown) && !props.preventInfoModal)

function openIfDetailed() {
  if (canOpen.value) infoModal.value.open()
}

const rolls = computed<Roll[]>(() => {
  if (!props.rollAction || !isListening.value) return []
  return [
    {
      key: 'statbox-roll',
      label: t('common.roll'),
      color: 'blue',
      dice: ['d20'],
      armed: true,
      execute: (faces) => props.rollAction!(faces?.[0])
    }
  ]
})

defineExpose({ infoModal })
</script>
<template>
  <div
    data-component="StatBox"
    :data-proficiency-level="proficiency"
    :data-has-details="canOpen"
    :data-rollable="rollAction ? true : undefined"
  >
    <div
      class="fit-content"
      :class="{
        'active:drop-shadow-glow cursor-pointer': canOpen
      }"
      @click="openIfDetailed"
    >
      <div
        :class="proficiencyLevels[props.proficiency ?? 0]?.color"
        class="overflow-visible pb-1 text-[0.8rem] whitespace-nowrap uppercase"
      >
        {{ heading }}
      </div>
      <div class="text-lg whitespace-nowrap">
        <slot></slot>
      </div>
      <div class="hidden whitespace-nowrap uppercase">{{ fullHeading }}</div>
    </div>
    <Teleport to="#modals">
      <InfoModal ref="infoModal" :rolls="rolls">
        <div>
          <h3 class="mb-2 text-xl">
            {{ modalHeading ?? heading }}
            <span
              v-if="props.proficiency"
              :data-proficiency-level="props.proficiency"
              :class="proficiencyLevels[props.proficiency].color"
              class="text-sm"
            >
              ({{ $t(proficiencyLevels[props.proficiency].labelKey) }})
            </span>
          </h3>
          <h4 class="text-l mb-2">{{ subheading }}</h4>
          <div>{{ props?.breakdown }}</div>
          <ul>
            <li
              v-for="mod in props?.modifiers?.filter(
                (m: Modifier) => m.enabled || !m.hideIfDisabled
              )"
              data-part="modifier"
              :data-disabled="!mod.enabled || undefined"
              class="flex gap-2"
              :class="{ 'text-gray-300': !mod.enabled }"
              :key="'mod_' + mod.slug"
            >
              <div class="w-8 text-right">
                {{ SignedNumber.format(mod.modifier ?? 0) }}
              </div>
              <div class="text-ellipsis whitespace-nowrap">
                {{ mod.label }}
              </div>
            </li>
          </ul>
        </div>
      </InfoModal>
    </Teleport>
  </div>
</template>
