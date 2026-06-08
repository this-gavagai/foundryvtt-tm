<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignedNumber } from '@/utils/formatters'
import { proficiencyLevels } from '@/utils/constants'
import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Modifier } from '@/composables/character'
import { useModifierOverrides } from '@/composables/useModifierOverrides'

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
  rollAction?: (
    r: number | undefined,
    options?: { modifierOverrides?: Record<string, boolean> }
  ) => Promise<RequestResolutionArgs | null>
}>()
const infoModal = ref()
const { isListening } = storeToRefs(useListenersStore())

const canOpen = computed(() => (props?.modifiers || props?.breakdown) && !props.preventInfoModal)

function openIfDetailed() {
  if (canOpen.value) infoModal.value.open()
}

// Modifier toggling only makes sense for rollable stats — flipping a
// modifier on a display-only StatBox (AC, HP, etc.) would have no effect
// since there's no roll to feed the overrides into. canToggleModifiers
// gates both the click handler and the cursor/visual affordances below.
const canToggleModifiers = computed(() => !!props.rollAction)
const {
  modifierOverrides,
  toggleModifier: toggleModifierOverride,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(computed(() => props.modifiers))

function toggleModifier(mod: Modifier) {
  if (canToggleModifiers.value) toggleModifierOverride(mod)
}

// Sum of all effectively-enabled, non-stacking-loser modifiers — drives the
// roll button label so the user can see the combined modifier before rolling.
const effectiveTotal = computed<number | undefined>(() => {
  const mods = props.modifiers
  if (!mods?.length) return undefined
  return mods
    .filter((m) => effectiveEnabled(m) && !isStackingLoser(m))
    .reduce((sum, m) => sum + (m.modifier ?? 0), 0)
})

const rolls = computed<Roll[]>(() => {
  if (!props.rollAction || !isListening.value) return []
  const totalLabel =
    effectiveTotal.value !== undefined ? ' ' + SignedNumber.format(effectiveTotal.value) : ''
  return [
    {
      key: 'statbox-roll',
      label: t('common.roll') + totalLabel,
      color: 'blue',
      dice: ['d20'],
      armed: true,
      execute: (faces) => {
        const overrides = modifierOverrides.value
        const hasOverrides = Object.keys(overrides).length > 0
        return props.rollAction!(
          faces?.[0],
          hasOverrides ? { modifierOverrides: { ...overrides } } : undefined
        )
      }
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
        class="overflow-visible pb-1 text-center text-[0.65rem] whitespace-nowrap uppercase"
      >
        {{ heading }}
      </div>
      <div class="text-center text-lg whitespace-nowrap" data-part="modifier">
        <slot></slot>
      </div>
      <div class="hidden whitespace-nowrap uppercase">{{ fullHeading }}</div>
    </div>
    <Teleport to="#modals">
      <InfoModal ref="infoModal" :rolls="rolls" @closing="modifierOverrides = {}">
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
          <ModifierOverrideList
            :modifiers="props.modifiers"
            :toggleable="canToggleModifiers"
            :effectiveEnabled="effectiveEnabled"
            :isManuallyActivated="isManuallyActivated"
            :isManuallyDeactivated="isManuallyDeactivated"
            :isStackingLoser="isStackingLoser"
            :onToggle="toggleModifier"
          />
        </div>
      </InfoModal>
    </Teleport>
  </div>
</template>
