<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedActor } from '@/composables/injectKeys'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { freeRoll } from '@/api/actionRpc'
import { SignedNumber } from '@/utils/formatters'
import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import ChipToggle from '@/components/widgets/ChipToggle.vue'
import ModifierStepper from '@/components/widgets/ModifierStepper.vue'
import type { Modifier } from '@/composables/character'
import type { Roll } from '@/types/roll-types'
import type { RequestResolutionArgs } from '@/types/api-types'

const { t } = useI18n()
const { _id: characterId, skills, perception, saves, doFlatCheck } = useInjectedActor()

const modalRef = ref()
const isSecret = ref(false)
const flatModifier = ref(0)

// A roller groups a label with the dispatch function for one chit, plus the
// statistic's own resolved modifiers (Layer 1) so the modal can reflect them
// instead of guessing. Lets the template render uniformly: a single `<span>`
// per chit driven by `Roller[]`.
type Roller = {
  slug: string
  label: string
  italic?: boolean
  // The statistic's real modifiers, straight off the resolved stat. undefined
  // for rollers with no statistic behind them (flat DC / raw d20).
  modifiers?: Modifier[]
  execute: (face?: number, options?: object) => Promise<RequestResolutionArgs | null>
}

// Single-select. When set, the d20 routes through that roller's execute. When
// undefined: raw d20 via freeRoll.
const activeSlug = ref<string | undefined>(undefined)
function toggleStat(slug: string) {
  activeSlug.value = activeSlug.value === slug ? undefined : slug
}

// ── Layer 2: descriptive traits ────────────────────────────────────────────
// Multi-select roll-option traits. Attached to the roll as both display labels
// (traits[]) and rule-element predicate options (extraRollOptions[]). These are
// pure tags — they don't change the dice, only what rule elements see.
const DESCRIPTIVE_TRAITS = ['concentrate', 'manipulate'] as const
type DescriptiveTrait = (typeof DESCRIPTIVE_TRAITS)[number]
const selectedTraits = ref<Set<DescriptiveTrait>>(new Set())
function toggleTrait(slug: DescriptiveTrait) {
  const next = new Set(selectedTraits.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  selectedTraits.value = next
}

// ── Layer 4: roll mechanics ────────────────────────────────────────────────
// Fortune / misfortune are traits that also drive PF2e's rollTwice mechanic
// (2d20kh / 2d20kl), so they live here rather than with the descriptive traits.
// They're mutually exclusive (selecting both would cancel), so a single
// tri-state — fortune / neither / misfortune — models them exactly.
const fortuneState = ref<'fortune' | 'misfortune' | null>(null)
function toggleFortune(which: 'fortune' | 'misfortune') {
  fortuneState.value = fortuneState.value === which ? null : which
}

// Roller groups, rendered as labeled sub-rows in the template. Order matters
// — saves and the spotlight rolls (perception/initiative) sit above the long
// skill list since they're rolled more often.
const saveRollers = computed<Roller[]>(() => [
  {
    slug: 'fortitude',
    label: saves.fortitude.value?.label ?? t('saves.fortitude'),
    modifiers: saves.fortitude.value?.modifiers ?? undefined,
    execute: (face, opts) => saves.fortitude.value?.roll?.(face, opts) ?? Promise.resolve(null)
  },
  {
    slug: 'reflex',
    label: saves.reflex.value?.label ?? t('saves.reflex'),
    modifiers: saves.reflex.value?.modifiers ?? undefined,
    execute: (face, opts) => saves.reflex.value?.roll?.(face, opts) ?? Promise.resolve(null)
  },
  {
    slug: 'will',
    label: saves.will.value?.label ?? t('saves.will'),
    modifiers: saves.will.value?.modifiers ?? undefined,
    execute: (face, opts) => saves.will.value?.roll?.(face, opts) ?? Promise.resolve(null)
  }
])

// Empty (and hidden by the group's v-if) on actors without flat checks. Flat
// checks carry no statistic modifiers, so no modifier list appears for them.
const flatRollers: Roller[] = doFlatCheck
  ? [
      {
        slug: 'flat-5',
        label: t('rolls.flatDc', { dc: 5 }),
        execute: (face, opts) => doFlatCheck(face, { ...(opts ?? {}), dc: 5 })
      },
      {
        slug: 'flat-11',
        label: t('rolls.flatDc', { dc: 11 }),
        execute: (face, opts) => doFlatCheck(face, { ...(opts ?? {}), dc: 11 })
      }
    ]
  : []

// Perception leads the skill list, followed by trained skills, with lore
// skills appended at the end in italics. Initiative is intentionally omitted —
// it's rolled from the combat tracker, not the side-menu check builder.
const skillRollers = computed<Roller[]>(() => {
  const list: Roller[] = []
  if (perception.value) {
    list.push({
      slug: perception.value.slug ?? 'perception',
      label: perception.value.label ?? t('saves.perception'),
      modifiers: perception.value.modifiers ?? undefined,
      execute: (face, opts) => perception.value!.roll?.(face, opts) ?? Promise.resolve(null)
    })
  }
  for (const s of skills.value ?? []) {
    if (s.lore) continue
    list.push({
      slug: s.slug ?? '',
      label: s.label ?? s.slug ?? '',
      modifiers: s.modifiers ?? undefined,
      execute: (face, opts) => s.roll?.(face, opts) ?? Promise.resolve(null)
    })
  }
  for (const s of skills.value ?? []) {
    if (!s.lore) continue
    list.push({
      slug: s.slug ?? '',
      label: s.label ?? s.slug ?? '',
      italic: true,
      modifiers: s.modifiers ?? undefined,
      execute: (face, opts) => s.roll?.(face, opts) ?? Promise.resolve(null)
    })
  }
  return list
})

const allRollers = computed<Roller[]>(() => [
  ...saveRollers.value,
  ...flatRollers,
  ...skillRollers.value
])

const activeRoller = computed(() => allRollers.value.find((r) => r.slug === activeSlug.value))
const activeLabel = computed(() => activeRoller.value?.label ?? '')

// ── Layer 1: the selected statistic's modifiers ────────────────────────────
// Reflected straight off the resolved stat, toggled per-roll via the same
// override machinery StatBox uses (stacking simulation, crit context, manual
// on/off). The chosen toggles ride along as `modifierOverrides` so PF2e
// re-resolves the check server-side.
const activeModifiers = computed<Modifier[]>(() => activeRoller.value?.modifiers ?? [])
const {
  modifierOverrides,
  toggleModifier,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(activeModifiers)

// Switching statistics invalidates any in-flight per-modifier toggles — start
// the new selection clean.
watch(activeSlug, () => {
  modifierOverrides.value = {}
})

// Sum of effectively-enabled, non-stacking-loser modifiers — mirrors StatBox so
// the button label previews the combined modifier before rolling.
const effectiveTotal = computed<number | undefined>(() => {
  const mods = activeModifiers.value
  if (!mods.length) return undefined
  return mods
    .filter((m) => effectiveEnabled(m) && !isStackingLoser(m))
    .reduce((sum, m) => sum + (m.modifier ?? 0), 0)
})

// The total shown on the roll button: the statistic's effective modifier (if a
// stat is selected) plus the situational, else just the situational.
const rollTotal = computed<number | undefined>(() => {
  if (effectiveTotal.value === undefined) return flatModifier.value || undefined
  return effectiveTotal.value + flatModifier.value
})

const flatSuffix = computed(() =>
  flatModifier.value ? ' ' + SignedNumber.format(flatModifier.value) : ''
)

const checkRolls = computed<Roll[]>(() => [
  {
    key: 'roll-check',
    label: activeLabel.value
      ? `${t('common.roll')} ${activeLabel.value}${
          rollTotal.value !== undefined ? ' ' + SignedNumber.format(rollTotal.value) : ''
        }`
      : t('sideMenu.rollD20') + flatSuffix.value,
    color: 'blue',
    dice: ['d20'],
    armed: true,
    execute: async (faces?: number[]) => {
      const roller = activeRoller.value
      // PF2e's Statistic.roll uses `messageMode` for chat-card visibility (with
      // Foundry's ChatMessageMode vocabulary: "public" | "gm" | "blind" | …),
      // distinct from `rollMode` (the Roll.toMessage vocabulary: "publicroll" |
      // "blindroll" | …). The two are not aliases — passing 'blindroll' here
      // silently falls through to the user's default. The freeRoll fallback
      // below uses Foundry's native path and keeps `rollMode`.
      const traitList = [
        ...selectedTraits.value,
        ...(fortuneState.value ? [fortuneState.value] : [])
      ]
      // Fortune / misfortune drive rollTwice — see check.ts:124. The tri-state
      // guarantees at most one is set, so there's no both-cancel case.
      const rollTwice =
        fortuneState.value === 'fortune'
          ? 'keep-higher'
          : fortuneState.value === 'misfortune'
            ? 'keep-lower'
            : undefined
      const options: Record<string, unknown> = {}
      if (isSecret.value) options.messageMode = 'blind'
      if (traitList.length) {
        options.traits = traitList
        options.extraRollOptions = traitList
      }
      if (rollTwice) options.rollTwice = rollTwice
      if (flatModifier.value) options._flatModifier = flatModifier.value
      // Per-roll modifier toggles: PF2e re-resolves the statistic with these
      // applied. Only meaningful when a real statistic is selected.
      const overrides = modifierOverrides.value
      if (Object.keys(overrides).length) options.modifierOverrides = { ...overrides }
      const result = roller
        ? await roller.execute(faces?.[0], options)
        : await freeRoll(
            characterId.value ?? '',
            isSecret.value,
            faces?.[0],
            traitList.length ? traitList : undefined,
            flatModifier.value || undefined
          )
      // Reset selections after the roll fires so the next open starts fresh.
      activeSlug.value = undefined
      selectedTraits.value = new Set()
      fortuneState.value = null
      flatModifier.value = 0
      modifierOverrides.value = {}
      return result
    }
  }
])

function open() {
  modalRef.value?.open()
}
function close() {
  modalRef.value?.close()
}

// Drop the active selection if the character switches under us and that slug
// no longer exists.
watch(skills, () => {
  if (activeSlug.value && !allRollers.value.find((r) => r.slug === activeSlug.value)) {
    activeSlug.value = undefined
  }
})

defineExpose({ open, close })
</script>
<template>
  <InfoModal ref="modalRef" :rolls="checkRolls">
    <template #title>{{ $t('sideMenu.freeRollTitle') }}</template>
    <template #bottomLeft>
      <Toggle :active="isSecret" @changed="(v: boolean) => (isSecret = v)">
        <span class="text-sm">{{ $t('sideMenu.secret') }}</span>
      </Toggle>
    </template>
    <template #beforeBody>
      <div data-component="RollCheckBuilder">
        <!-- Layer 0: statistic picker. Each sub-row groups thematically related
             rollers. The chip styling is shared across all rows via the
             `check-traits` data-part. -->
        <template
          v-for="(group, gi) in [
            { label: $t('rollCheck.saves'), rollers: saveRollers },
            { label: $t('rollCheck.flat'), rollers: flatRollers },
            { label: $t('rollCheck.skills'), rollers: skillRollers }
          ]"
          :key="gi"
        >
          <div v-if="group.rollers.length" class="mt-3">
            <h4 class="text-xs tracking-wide text-gray-600 uppercase">{{ group.label }}</h4>
            <div data-part="check-traits" class="mt-1 flex flex-wrap gap-1">
              <ChipToggle
                v-for="r in group.rollers"
                :key="r.slug"
                :active="activeSlug === r.slug"
                :class="{ italic: r.italic }"
                @toggle="toggleStat(r.slug)"
              >
                {{ r.label }}
              </ChipToggle>
            </div>
          </div>
        </template>

        <!-- Layer 1: the selected statistic's real modifiers, reflected off the
             resolved stat. Tap to toggle for this roll (rides along as
             modifierOverrides); type tags and stacking strike-through come from
             the shared ModifierOverrideList. Hidden until a statistic with
             modifiers is selected. -->
        <div v-if="activeModifiers.length" class="mt-3">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('rollCheck.modifiers') }}
          </h4>
          <ModifierOverrideList
            class="mt-1"
            :modifiers="activeModifiers"
            :toggleable="true"
            :effectiveEnabled="effectiveEnabled"
            :isManuallyActivated="isManuallyActivated"
            :isManuallyDeactivated="isManuallyDeactivated"
            :isStackingLoser="isStackingLoser"
            :onToggle="toggleModifier"
          />
        </div>

        <!-- Layer 2: descriptive traits. Attach to the roll as labels and
             rule-element predicate options. -->
        <div class="mt-3">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('rollCheck.traits') }}
          </h4>
          <div data-part="check-traits" class="mt-1 flex flex-wrap gap-1">
            <ChipToggle
              v-for="trait in DESCRIPTIVE_TRAITS"
              :key="trait"
              :active="selectedTraits.has(trait)"
              class="capitalize"
              @toggle="toggleTrait(trait)"
            >
              {{ $t('rollCheck.trait.' + trait) }}
            </ChipToggle>
          </div>
        </div>

        <!-- Layer 4a: fortune / misfortune. Mutually exclusive — they drive
             rollTwice (2d20kh / 2d20kl) rather than merely tagging the roll. -->
        <div class="mt-3">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('rollCheck.luck') }}
          </h4>
          <div data-part="check-traits" class="mt-1 flex flex-wrap gap-1">
            <ChipToggle
              v-for="which in ['fortune', 'misfortune'] as const"
              :key="which"
              :active="fortuneState === which"
              class="capitalize"
              @toggle="toggleFortune(which)"
            >
              {{ $t('rollCheck.trait.' + which) }}
            </ChipToggle>
          </div>
        </div>

        <!-- Layer 4b: situational modifier accumulator. The one player-authored
             numeric delta PF2e can't infer; sent as an untyped Situational
             modifier. Resets to 0 after each roll. -->
        <div class="mt-3">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('rollCheck.situational') }}
          </h4>
          <ModifierStepper
            class="mt-1"
            :value="flatModifier"
            @step="flatModifier += $event"
            @clear="flatModifier = 0"
          />
        </div>
      </div>
    </template>
  </InfoModal>
</template>
