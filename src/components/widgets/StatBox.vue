<script setup lang="ts">
import { ref, computed, watch, useAttrs, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignedNumber } from '@/utils/formatters'
import { proficiencyLevels } from '@/utils/constants'
import { actorKey } from '@/composables/injectKeys'
import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import TraitList from '@/components/TraitList.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import type { RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Modifier } from '@/composables/character'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

const { t } = useI18n()

// StatBox is a generic widget used outside a sheet too (e.g. compendium
// browser), so inject non-throwingly. ParsedDescription itself requires the
// actor context, so we only render a variant's description when it's present.
const injectedActor = inject(actorKey, undefined)
const rollOptionLabels = injectedActor?.rollOptionLabels

// An alternate roll the modal can switch to — e.g. a skill action (Demoralize,
// Tumble Through) hung off a skill. Selecting one swaps the modal's modifiers,
// traits, and roll target while leaving the base stat in place to return to.
export interface StatBoxVariant {
  key: string
  label: string
  cost?: string
  traits?: string[]
  modifier?: number
  modifiers?: Modifier[]
  // Enriched HTML description shown when this variant is selected (skill actions).
  description?: string
  rollAction: (
    r: number | undefined,
    options?: {
      modifierOverrides?: Record<string, boolean>
      messageMode?: 'blind'
      rollMode?: 'blindroll'
    }
  ) => Promise<RequestResolutionArgs | null>
}

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
  variants?: StatBoxVariant[]
  rollAction?: (
    r: number | undefined,
    options?: {
      modifierOverrides?: Record<string, boolean>
      messageMode?: 'blind'
      rollMode?: 'blindroll'
    }
  ) => Promise<RequestResolutionArgs | null>
}>()

// Which variant (if any) the modal is currently showing. null = the base stat.
const selectedKey = ref<string | null>(null)
const selectedVariant = computed(
  () => props.variants?.find((v) => v.key === selectedKey.value) ?? null
)
// The base stat and each variant carry their own modifiers / roll / traits;
// everything downstream reads the "active" one so the modal updates in place.
const activeModifiers = computed(() =>
  selectedVariant.value ? (selectedVariant.value.modifiers ?? []) : props.modifiers
)
const activeRollAction = computed(() => selectedVariant.value?.rollAction ?? props.rollAction)
const activeTraits = computed(() => selectedVariant.value?.traits ?? [])
const infoModal = ref()
const isSecret = ref(false)
const { isListening } = storeToRefs(useListenersStore())

const canOpen = computed(
  () =>
    (props?.modifiers || props?.breakdown || props.variants?.length) && !props.preventInfoModal
)

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
const canToggleModifiers = computed(() => !!activeRollAction.value)
const {
  modifierOverrides,
  toggleModifier: toggleModifierOverride,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(activeModifiers)

// Switching variants changes the modifier set entirely, so any in-flight
// per-modifier toggles no longer apply — start the new selection clean.
// A secret-trait action (e.g. Recall Knowledge, Sense Direction) should roll
// blind, so auto-arm the secret toggle on select and disarm it on deselect.
watch(selectedKey, () => {
  modifierOverrides.value = {}
  isSecret.value = selectedVariant.value?.traits?.includes('secret') ?? false
})

function onModalClosed() {
  modifierOverrides.value = {}
  selectedKey.value = null
  isSecret.value = false
}

function toggleModifier(mod: Modifier) {
  if (canToggleModifiers.value) toggleModifierOverride(mod)
}

// Sum of all effectively-enabled, non-stacking-loser modifiers — drives the
// roll button label so the user can see the combined modifier before rolling.
const effectiveTotal = computed<number | undefined>(() => {
  const mods = activeModifiers.value
  if (!mods?.length) return undefined
  return mods
    .filter((m) => effectiveEnabled(m) && !isStackingLoser(m))
    .reduce((sum, m) => sum + (m.modifier ?? 0), 0)
})

const rolls = computed<Roll[]>(() => {
  if (!activeRollAction.value || !isListening.value) return []
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
        return activeRollAction.value!(faces?.[0], Object.keys(options).length ? options : undefined)
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
      <InfoModal ref="infoModal" :rolls="rolls" @closing="onModalClosed">
        <template #bottomLeft>
          <Toggle
            v-if="activeRollAction && isListening"
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
          <h4 v-if="subheading" class="text-l mb-2">{{ subheading }}</h4>
          <div v-if="!selectedVariant && props?.breakdown">{{ props?.breakdown }}</div>
          <!-- Skill actions usable with this stat, grouped in a contained
               sub-box so they read as their own set of toggles rather than
               floating chips. Tap one to switch the modal to that action's
               modifiers/traits/roll; tap the active one again to return to the
               plain skill roll. -->
          <div
            v-if="props.variants?.length"
            class="border-divider mt-3 mb-4 flex flex-wrap gap-2 rounded-lg border bg-black/3 p-2.5 dark:bg-white/5"
          >
            <button
              v-for="variant in props.variants"
              :key="variant.key"
              type="button"
              class="rounded-full border px-3 py-1 text-sm transition-colors active:opacity-50"
              :class="
                selectedKey === variant.key
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-divider bg-white dark:bg-white/10'
              "
              @click="selectedKey = selectedKey === variant.key ? null : variant.key"
            >
              <ActionIcons
                v-if="variant.cost"
                :actions="variant.cost"
                class="relative -mb-0.5 mr-1 text-base leading-none"
              />
              {{ variant.label }}
              <span v-if="variant.modifier !== undefined" class="opacity-70">
                {{ SignedNumber.format(variant.modifier) }}
              </span>
            </button>
          </div>
          <TraitList
            v-if="activeTraits.length"
            :traits="activeTraits"
            class="mt-2 mb-3 text-sm [&_p]:my-2"
          />
          <ModifierOverrideList
            :modifiers="activeModifiers"
            :toggleable="canToggleModifiers"
            :effectiveEnabled="effectiveEnabled"
            :isManuallyActivated="isManuallyActivated"
            :isManuallyDeactivated="isManuallyDeactivated"
            :isStackingLoser="isStackingLoser"
            :onToggle="toggleModifier"
          />
          <!-- Selected skill action's rulebook description (rich HTML from the
               pf2e.actionspf2e compendium). Read-only: autoSelect off so inline
               check/damage radios aren't pre-armed; the primary roll is the
               action's own check via the roll button below. -->
          <ParsedDescription
            v-if="injectedActor && selectedVariant?.description"
            :text="selectedVariant.description"
            :labels="rollOptionLabels"
            :autoSelect="false"
            class="mt-3 mb-3 max-w-full min-w-0 overflow-x-auto text-sm wrap-anywhere [&_p]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
          />
        </div>
      </InfoModal>
    </Teleport>
  </div>
</template>
