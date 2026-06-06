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
          <ul>
            <li
              v-for="mod in props?.modifiers?.filter(
                // Show every default-visible modifier (default-enabled, or
                // disabled-but-not-hidden), plus any default-hidden one the
                // user has manually overridden — without the latter rule
                // they couldn't toggle a manual-activate back off.
                (m: Modifier) =>
                  m.enabled || !m.hideIfDisabled || (m.slug && m.slug in modifierOverrides)
              )"
              data-part="modifier"
              :data-disabled="
                !effectiveEnabled(mod) && !isManuallyActivated(mod) && !isManuallyDeactivated(mod)
                  ? true
                  : undefined
              "
              :data-manual-on="isManuallyActivated(mod) || undefined"
              :data-manual-off="isManuallyDeactivated(mod) || undefined"
              :data-stacking-loser="isStackingLoser(mod) || undefined"
              :title="
                isStackingLoser(mod)
                  ? 'Outranked by a higher same-type modifier; will not contribute to the roll'
                  : undefined
              "
              class="grid grid-cols-[2.5rem_6rem_1fr] items-center gap-2 rounded-sm border border-transparent px-1 py-0.5"
              :class="{
                'cursor-pointer': canToggleModifiers,
                'text-gray-300': !effectiveEnabled(mod) && !isManuallyDeactivated(mod),
                'border-green-500 bg-green-100/40 dark:bg-green-900/30': isManuallyActivated(mod),
                'border-red-500 bg-red-100/40 text-red-700 line-through dark:bg-red-900/30 dark:text-red-300':
                  isManuallyDeactivated(mod),
                // Stacking loser: dim and strike through so it's clear PF2e
                // will pick the higher-priority same-type modifier instead.
                // Keeps any green/red override border so the user still sees
                // their click registered, but the row reads as 'not used'.
                'line-through opacity-50': isStackingLoser(mod)
              }"
              :key="'mod_' + mod.slug"
              @click="toggleModifier(mod)"
            >
              <div class="text-right">
                {{ SignedNumber.format(mod.modifier ?? 0) }}
              </div>
              <!-- Bonus type tag, e.g. [STATUS]. Untyped/missing render an
                   empty cell so the type column reserves the same width
                   on every row, keeping labels left-aligned across the
                   list — that's what makes the grid layout worth it. -->
              <div
                data-part="modifier-type"
                class="text-[0.65rem] tracking-wide uppercase opacity-60"
              >
                <template v-if="mod.type && mod.type !== 'untyped'">[{{ mod.type }}]</template>
              </div>
              <div class="overflow-hidden text-ellipsis whitespace-nowrap">
                {{ mod.label }}
              </div>
            </li>
          </ul>
        </div>
      </InfoModal>
    </Teleport>
  </div>
</template>
