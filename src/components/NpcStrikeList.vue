<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { SignedNumber } from '@/utils/formatters'
import { useInjectedNpc } from '@/composables/injectKeys'
import { useListenersStore } from '@/stores/listenersOnline'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { makeDiceResults, parseDamageFormulaDice } from '@/utils/diceFormula'
import { traitsForViewed, variantLabelForViewed, type ViewedStrike } from '@/utils/strikes'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import type { Modifier } from '@/composables/character'
import type { Roll } from '@/types/roll-types'

import InfoModal from '@/components/InfoModal.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import StrikeActionSet from '@/components/StrikeListActionSet.vue'
import StrikeDetails from '@/components/StrikeDetails.vue'

// The NPC counterpart of StrikeList. NPC attacks are generated from the
// creature's `melee` items, which means none of the character-sheet strike
// machinery applies: no elemental blasts, no ammunition or reload, no
// versatile/modular damage-type toggles, and no alternate usages. What remains
// is the attack/damage roll pair per strike plus the modifier breakdown, so
// this list drives the same InfoModal + StrikeDetails panel with a much smaller
// surface. The two "attack effects" NPCs uniquely have (Grab, Knockdown, …) are
// listed under each strike, mirroring the stat block.

interface EmitOptions {
  type: string
  subtype: number
}

// The strike-damage preview as this list uses it. The wire type is a union with
// the spell preview and carries raw PF2e modifiers; StrikeDetails wants the
// app's own Modifier shape, so narrow once here rather than at each read.
interface StrikeDamageData {
  response?: {
    damage?: string
    critical?: string
    modifiers?: Modifier[]
  }
}

const { t } = useI18n()
const { strikes } = useInjectedNpc()
const { isListening } = storeToRefs(useListenersStore())

const strikeModal = ref<InstanceType<typeof InfoModal>>()
const strikeModalDamage = ref<StrikeDamageData | undefined>()
const viewed = ref<ViewedStrike | undefined>()

const attackModifiers = computed(() =>
  viewed.value?.phase === 'attack' ? (viewed.value?.target.data._modifiers ?? []) : []
)
const viewedModifiers = computed(() =>
  viewed.value?.phase === 'damage'
    ? (strikeModalDamage.value?.response?.modifiers ?? [])
    : attackModifiers.value
)
// subtype 1 = critical damage, which flips how critical-only modifiers read.
const isCriticalContext = computed(
  () => viewed.value?.phase === 'damage' && viewed.value?.subtype === 1
)
const {
  modifierOverrides,
  toggleModifier,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(viewedModifiers, isCriticalContext)

// Effective base total (MAP 0, no extra modifiers) with overrides applied,
// compared against the total PF2e already put in the first variant's label.
const effectiveAttackBase = computed(() =>
  attackModifiers.value
    .filter((m) => effectiveEnabled(m) && !isStackingLoser(m))
    .reduce((sum, m) => sum + (m.modifier ?? 0), 0)
)
const attackDelta = computed(() => {
  const v = viewed.value
  if (!v || v.phase !== 'attack' || !Object.keys(modifierOverrides.value).length) return 0
  const baseLabel = v.target.data.variants?.find((variant) => variant.map === 0)?.label ?? ''
  const match = baseLabel.match(/^([+-]?\d+)/)
  if (!match) return 0
  return effectiveAttackBase.value - parseInt(match[1], 10)
})

const viewedStrike = computed(() =>
  viewed.value?.target.kind === 'strike' ? strikes.value?.[viewed.value.target.index] : undefined
)
const viewedTraits = computed<string[]>(() => traitsForViewed(viewed.value, undefined))

function pickStrike(opts: EmitOptions, index: number) {
  const strike = strikes.value?.[index]
  if (!strike) return
  viewed.value = {
    target: { kind: 'strike', data: strike, index },
    phase: opts.type.endsWith('_damage') ? 'damage' : 'attack',
    subtype: opts.subtype
  }
  strikeModal.value?.open()
}

function doViewedAttack(diceResult?: number): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  const overrides = Object.keys(modifierOverrides.value).length
    ? { ...modifierOverrides.value }
    : undefined
  return (
    v.target.data.doStrike?.(v.subtype, undefined, undefined, diceResult, overrides) ??
    Promise.resolve(null)
  )
}

function doViewedDamage(result?: DiceResults): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  const overrides = Object.keys(modifierOverrides.value).length
    ? { ...modifierOverrides.value }
    : undefined
  return (
    v.target.data.doDamage?.(v.subtype, undefined, undefined, result, overrides) ??
    Promise.resolve(null)
  )
}

// Declare the physical faces the damage roll expects, so a Pixel die can be
// matched against the fetched formula (same contract as StrikeList).
const damageDice = computed<string[]>(() => {
  const v = viewed.value
  if (!v || v.phase !== 'damage') return []
  const formula = v.subtype
    ? strikeModalDamage.value?.response?.critical
    : strikeModalDamage.value?.response?.damage
  return parseDamageFormulaDice(formula)
})

const strikeRolls = computed<Roll[]>(() => {
  const v = viewed.value
  if (!v || !isListening.value) return []
  if (v.phase === 'attack') {
    const variantLabel = variantLabelForViewed(v)
    const delta = attackDelta.value
    const adjustedLabel = (() => {
      if (delta === 0) return variantLabel
      const match = variantLabel.match(/^([+-]?\d+)/)
      if (!match) return variantLabel
      return SignedNumber.format(parseInt(match[1], 10) + delta)
    })()
    const label = v.subtype === 0 ? `${t('strikes.strike')} ${adjustedLabel}` : adjustedLabel
    return [
      {
        key: 'strike-attack',
        label: label.trim(),
        color: 'blue',
        dice: ['d20'],
        armed: true,
        execute: (faces) => doViewedAttack(faces?.[0])
      }
    ]
  }
  const dice = damageDice.value
  return [
    {
      key: 'strike-damage',
      label: v.subtype ? t('strikes.critical') : t('strikes.damage'),
      color: 'red',
      dice: dice.length ? dice : undefined,
      execute: (faces) =>
        doViewedDamage(faces && dice.length ? makeDiceResults(dice, faces) : undefined)
    }
  ]
})

async function updateDamageFormula() {
  const v = viewed.value
  if (!v || v.phase !== 'damage' || !isListening.value) {
    strikeModalDamage.value = undefined
    return
  }
  // The @closing reset of modifierOverrides retriggers this watch while
  // `viewed` still points at the dismissed strike — skip the round-trip.
  if (!strikeModal.value?.isOpen) return
  const overrides = Object.keys(modifierOverrides.value).length
    ? { ...modifierOverrides.value }
    : undefined
  const overrideKey = JSON.stringify(overrides ?? {})
  const result = await v.target.data.getDamage?.(undefined, undefined, overrides)
  if (
    viewed.value !== v ||
    JSON.stringify(Object.keys(modifierOverrides.value).length ? modifierOverrides.value : {}) !==
      overrideKey
  )
    return
  strikeModalDamage.value = (result ?? undefined) as StrikeDamageData | undefined
}
watch([viewed, modifierOverrides], () => updateDamageFormula())

// The modal holds a snapshot of the opened strike; rebind it when the NPC
// re-syncs and the strikes array is rebuilt, or the panel shows stale numbers.
watch(strikes, () => {
  const v = viewed.value
  if (!v || v.target.kind !== 'strike') return
  const fresh = strikes.value?.[v.target.index]
  if (fresh) v.target.data = fresh
})
</script>
<template>
  <div data-component="NpcStrikeList">
    <SheetSection
      section="strikes"
      :title="$t('strikes.strikesHeading')"
      class="[&:not(:has(li))]:hidden"
    >
      <ul>
        <li v-for="(strike, i) in strikes" class="cursor-pointer pb-2" :key="strike.slug ?? i">
          <StrikeActionSet
            type="strike"
            :id="i"
            :label="strike?.label"
            :isRanged="strike?.isRanged ?? false"
            :range="strike?.range"
            :mapLabelSet="strike.variants"
            @clicked="(_id, options) => pickStrike(options, i)"
          />
          <div
            v-if="strike.attackEffects?.length"
            data-part="attack-effects"
            class="text-xs italic"
          >
            {{ $t('npc.attackEffects') }}
            {{ strike.attackEffects.join(', ') }}
          </div>
        </li>
      </ul>
    </SheetSection>
    <Teleport to="#modals">
      <InfoModal
        ref="strikeModal"
        :itemId="viewedStrike?.item?._id ?? undefined"
        :traits="viewedTraits"
        :rolls="strikeRolls"
        @closing="modifierOverrides = {}"
        :imageUrl="viewedStrike?.item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp'"
      >
        <template #title>{{ viewed?.target.data.label }}</template>
        <template #description>{{
          viewed?.phase === 'damage' && viewed?.subtype === 1
            ? strikeModalDamage?.response?.critical
            : strikeModalDamage?.response?.damage
        }}</template>
        <StrikeDetails
          :viewed="viewed"
          :damageData="strikeModalDamage"
          :damageTypeOptions="[]"
          :isListening="isListening"
          :effectiveEnabled="effectiveEnabled"
          :isManuallyActivated="isManuallyActivated"
          :isManuallyDeactivated="isManuallyDeactivated"
          :isStackingLoser="isStackingLoser"
          :onToggleModifier="toggleModifier"
          :onToggleLoaded="() => {}"
          :onUpdateDamageType="() => {}"
          :onSetBlastActions="() => {}"
        />
      </InfoModal>
    </Teleport>
  </div>
</template>
