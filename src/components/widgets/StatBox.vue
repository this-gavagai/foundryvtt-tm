<script setup lang="ts">
import { ref, computed, useAttrs } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignedNumber } from '@/utils/formatters'
import { proficiencyLevels } from '@/utils/constants'
import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Modifier } from '@/composables/character'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

const { t } = useI18n()
const props = defineProps<{
  heading?: string
  subheading?: string
  fullHeading?: string
  modalHeading?: string
  proficiency?: number
  // Lay the heading and value out on a single row (name left, value right)
  // instead of the default centered stack — used by list contexts like skills.
  row?: boolean
  modifiers?: Modifier[] | undefined
  breakdown?: string
  preventInfoModal?: boolean
  rollAction?: (
    r: number | undefined,
    options?: {
      modifierOverrides?: Record<string, boolean>
      messageMode?: 'blind'
      rollMode?: 'blindroll'
    }
  ) => Promise<RequestResolutionArgs | null>
}>()
const infoModal = ref()
const isSecret = ref(false)
const { isListening } = storeToRefs(useListenersStore())

const canOpen = computed(() => (props?.modifiers || props?.breakdown) && !props.preventInfoModal)

// A StatBox is also interactive when the caller attaches an external click
// handler (HP, hero points, etc.) that falls through to the root element. We
// surface the same press feedback in that case so taps feel responsive.
const attrs = useAttrs()
const isClickable = computed(() => !!canOpen.value || !!attrs.onClick)

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
        const options = {
          ...(hasOverrides ? { modifierOverrides: { ...overrides } } : {}),
          ...(isSecret.value
            ? { messageMode: 'blind' as const, rollMode: 'blindroll' as const }
            : {})
        }
        return props.rollAction!(faces?.[0], Object.keys(options).length ? options : undefined)
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
      :class="[
        { 'flex items-baseline justify-between gap-2': row },
        {
          // Tactile press: the content sinks in slightly and dims on tap,
          // snapping back on release. Subtle, just enough to confirm the touch.
          'cursor-pointer transition duration-180 ease-out active:opacity-50 active:duration-60':
            isClickable,
          // Row-mode boxes are wide, so a 0.90 scale travels too far and reads
          // as a lurch; ease it back to a gentler dip. Stacked boxes keep the
          // fuller press since they're compact.
          'active:scale-[0.90]': isClickable && !row,
          'active:scale-[0.97]': isClickable && row
        }
      ]"
      @click="openIfDetailed"
      @pointerdown="isClickable && triggerLightHapticFeedback()"
    >
      <div
        :class="[
          proficiencyLevels[props.proficiency ?? 0]?.color,
          row
            ? 'flex-1 overflow-hidden text-base text-ellipsis whitespace-nowrap text-left normal-case tracking-[0.02em]'
            : 'overflow-visible pb-1 text-center text-[0.65rem] whitespace-nowrap uppercase'
        ]"
      >
        {{ heading }}
      </div>
      <div
        class="text-center whitespace-nowrap"
        :class="[
          row ? 'text-base' : 'text-lg',
          { 'underline decoration-dotted underline-offset-4': rollAction }
        ]"
        data-part="modifier"
      >
        <slot></slot>
      </div>
      <div class="hidden whitespace-nowrap uppercase">{{ fullHeading }}</div>
    </div>
    <Teleport to="#modals">
      <InfoModal ref="infoModal" :rolls="rolls" @closing="modifierOverrides = {}">
        <template #bottomLeft>
          <Toggle
            v-if="props.rollAction && isListening"
            :active="isSecret"
            @changed="(v: boolean) => (isSecret = v)"
          >
            <span class="text-sm">{{ $t('sideMenu.secret') }}</span>
          </Toggle>
        </template>
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
