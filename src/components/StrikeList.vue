<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignedNumber } from '@/utils/formatters'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import InfoModal from './InfoModal.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import StrikeActionSet from './StrikeListActionSet.vue'
import StrikeDetails from './StrikeDetails.vue'
import type { Weapon } from '@/composables/character'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'
import {
  blastDamageType,
  damageTypeOptionsForViewed,
  damageTypeSelectedForViewed,
  traitsForViewed,
  variantLabelForViewed,
  type ViewedStrike
} from '@/utils/strikes'
import { useModifierOverrides } from '@/composables/useModifierOverrides'

import ActionIcons from './widgets/ActionIcons.vue'

interface EmitOptions {
  type: 'strike' | 'strike_damage' | 'blast' | 'blast_damage'
  subtype: number
}

const { t } = useI18n()
const character = useInjectedCharacter()
const {
  strikes,
  blasts,
  inventory,
  actions,
  blastActions,
  setBlastActions: characterSetBlastActions,
  kineticAuraActive,
  toggleKineticAura
} = character

const strikeModal = ref()
const strikeModalDamage = ref()
const viewed = ref<ViewedStrike | undefined>()

const attackModifiers = computed(() =>
  viewed.value?.phase === 'attack' ? (viewed.value?.target.data._modifiers ?? []) : []
)
const viewedModifiers = computed(() =>
  viewed.value?.phase === 'damage'
    ? (strikeModalDamage.value?.response?.modifiers ?? [])
    : attackModifiers.value
)
// subtype 1 = critical damage — informs useModifierOverrides so that
// critical===true modifiers show as enabled and critical===false as disabled.
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

// Effective base total (MAP 0, no extra modifiers) with overrides applied.
const effectiveAttackBase = computed(() =>
  attackModifiers.value
    .filter((m) => effectiveEnabled(m) && !isStackingLoser(m))
    .reduce((sum, m) => sum + (m.modifier ?? 0), 0)
)

// Delta vs. the default MAP-0 total (parsed from the first variant's label).
// We compare to the parsed label rather than re-simulating default stacking,
// keeping the logic simple and consistent with what PF2e already computed.
const attackDelta = computed(() => {
  const v = viewed.value
  if (!v || v.phase !== 'attack' || !Object.keys(modifierOverrides.value).length) return 0
  const baseLabel = v.target.data.variants?.find((vrt) => vrt.map === 0)?.label ?? ''
  const m = baseLabel.match(/^([+-]?\d+)/)
  if (!m) return 0
  return effectiveAttackBase.value - parseInt(m[1], 10)
})

const { isListening } = storeToRefs(useListenersStore())

// A reloadable weapon that isn't loaded can't strike until it's reloaded.
const viewedNeedsReload = computed(
  () =>
    viewed.value?.target.kind === 'strike' &&
    !!viewed.value.target.data.reloadable &&
    !viewed.value.target.data.loaded
)

// builders for click handlers
function pickStrike(opts: EmitOptions, index: number, altUsage?: number) {
  const strike =
    altUsage === undefined ? strikes.value?.[index] : strikes.value?.[index]?.altUsages[altUsage]
  if (!strike) return
  viewed.value = {
    target: { kind: 'strike', data: strike, index, altUsage },
    phase: opts.type.endsWith('_damage') ? 'damage' : 'attack',
    subtype: opts.subtype
  }
  strikeModal.value.open()
}

function pickBlast(opts: EmitOptions, index: number, isMelee: boolean) {
  const blast = blasts.value?.[index]
  if (!blast) return
  viewed.value = {
    target: { kind: 'blast', data: blast, index, isMelee },
    phase: opts.type.endsWith('_damage') ? 'damage' : 'attack',
    subtype: opts.subtype
  }
  strikeModal.value.open()
}

// derived
const viewedItem = computed<Weapon | undefined>(() => {
  const itemId = viewed.value?.target.data.item?._id
  if (!itemId) return undefined
  return [...(inventory.value || []), ...(actions.value || [])].find((i) => i._id === itemId) as
    | Weapon
    | undefined
})

const viewedTraits = computed<string[]>(() => traitsForViewed(viewed.value, viewedItem.value))

const viewedDamageTypeSelected = computed<string | undefined>(() =>
  damageTypeSelectedForViewed(viewed.value, viewedItem.value)
)

const damageTypeOptions = computed<string[]>(() =>
  damageTypeOptionsForViewed(viewed.value, viewedItem.value)
)

function doViewedAttack(diceResult?: number): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  const overrides = Object.keys(modifierOverrides.value).length
    ? { ...modifierOverrides.value }
    : undefined
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    return (
      (blast.doStrike?.(
        v.subtype,
        undefined,
        {
          element: blast.blastElement,
          damageType: blastDamageType(blast),
          isMelee: v.target.isMelee
        },
        diceResult,
        overrides
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
  return (
    (v.target.data.doStrike?.(
      v.subtype,
      v.target.altUsage,
      undefined,
      diceResult,
      overrides
    ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
  )
}

function doViewedDamage(result?: DiceResults): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  const overrides = Object.keys(modifierOverrides.value).length
    ? { ...modifierOverrides.value }
    : undefined
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    return (
      (blast.doDamage?.(
        v.subtype,
        undefined,
        {
          element: blast.blastElement,
          damageType: blastDamageType(blast),
          isMelee: v.target.isMelee
        },
        result,
        overrides
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
  return (
    (v.target.data.doDamage?.(
      v.subtype,
      v.target.altUsage,
      undefined,
      result,
      overrides
    ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
  )
}

// The damage formula is fetched into strikeModalDamage when the modal opens
// in damage phase. Parse it into an ordered dice list so the Roll can declare
// what physical faces to expect — empty until the formula resolves, which
// keeps the d20 / single-die path unaffected.
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
    // When modifier overrides are active, adjust the numeric total in the
    // variant label by the computed delta so the roll button reflects the
    // actual value that will be sent.
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
        disabled: viewedNeedsReload.value,
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
      disabled: viewedNeedsReload.value,
      dice: dice.length ? dice : undefined,
      // When physical faces are supplied (Pixel path), forward them as a
      // DiceResults payload; without faces the server rolls live.
      execute: (faces) =>
        doViewedDamage(faces && dice.length ? makeDiceResults(dice, faces) : undefined)
    }
  ]
})

function toggleLoaded() {
  const v = viewed.value
  if (!v || v.target.kind !== 'strike') return
  v.target.data.setLoaded?.(!v.target.data.loaded)
}

function updateDamageType(damageType: string) {
  return viewed.value?.target.data.setDamageType?.(damageType)?.then(() => updateDamageFormula())
}

function setBlastActions(actions: string) {
  characterSetBlastActions(actions)?.then(() => updateDamageFormula())
}

async function updateDamageFormula() {
  const v = viewed.value
  if (!v || v.phase !== 'damage' || !isListening.value) {
    strikeModalDamage.value = undefined
    return
  }
  const overrides = Object.keys(modifierOverrides.value).length
    ? { ...modifierOverrides.value }
    : undefined
  const overrideKey = JSON.stringify(overrides ?? {})
  let result: RequestResolutionArgs | null | undefined
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    result = await blast.getDamage?.(
      undefined,
      {
        element: blast.blastElement,
        damageType: blastDamageType(blast),
        isMelee: v.target.isMelee
      },
      overrides
    )
  } else {
    result = await v.target.data.getDamage?.(v.target.altUsage, undefined, overrides)
  }
  if (
    viewed.value !== v ||
    JSON.stringify(Object.keys(modifierOverrides.value).length ? modifierOverrides.value : {}) !==
      overrideKey
  )
    return
  strikeModalDamage.value = result
}
watch([viewed, modifierOverrides], () => updateDamageFormula())

// The modal captures a snapshot of the opened strike/blast. When the character
// re-syncs (after changing ammo, reloading, etc.) the strikes/blasts arrays are
// rebuilt, so rebind the snapshot to the fresh object — otherwise the modal
// keeps showing stale state (e.g. the ammo dropdown snapping back).
watch([strikes, blasts], () => {
  const v = viewed.value
  if (!v) return
  if (v.target.kind === 'strike') {
    const fresh =
      v.target.altUsage === undefined
        ? strikes.value?.[v.target.index]
        : strikes.value?.[v.target.index]?.altUsages?.[v.target.altUsage]
    if (fresh) v.target.data = fresh
  } else {
    const fresh = blasts.value?.[v.target.index]
    if (fresh) v.target.data = fresh
  }
})
</script>
<template>
  <div data-component="StrikeList">
    <div class="break-inside-avoid py-4 [&:not(:has(li))]:hidden">
      <div data-section="blasts" class="break-inside-avoid [&:not(:has(li))]:hidden">
        <h3 class="text-[1.1rem] font-normal tracking-[0.01em]">
          {{ $t('strikes.elementalBlastsHeading') }}
        </h3>
        <Button
          v-if="isListening"
          class="mt-1 mb-2"
          :color="kineticAuraActive ? 'lightgray' : 'blue'"
          :clicked="toggleKineticAura"
        >
          <ActionIcons
            v-if="!kineticAuraActive"
            actions="1"
            class="relative float-left mt-0.75 h-0 pr-2 text-lg leading-none"
          />
          {{ kineticAuraActive ? $t('strikes.deactivateAura') : $t('strikes.activateAura') }}
        </Button>
        <ul :class="{ 'pointer-events-none opacity-40': !kineticAuraActive }">
          <li v-for="(blast, i) in blasts" class="cursor-pointer pb-2" :key="blast.blastElement">
            <div v-for="attackType in ['melee', 'ranged']" :key="'at_' + attackType">
              <StrikeActionSet
                type="blast"
                :id="i"
                :isRanged="attackType === 'ranged'"
                :range="attackType === 'ranged' ? blast?.blastRange?.max : undefined"
                :label="$t('strikes.elementalBlastLabel', { element: blast.blastElement })"
                :mapLabelSet="blast?.variants.filter((v) => v.type === attackType)"
                @clicked="(_id, options) => pickBlast(options, i, attackType === 'melee')"
              />
            </div>
          </li>
        </ul>
      </div>
      <div
        data-section="strikes"
        class="break-inside-avoid [&:not(:has(li))]:hidden [div_&:not(.hidden)]:pt-2"
      >
        <h3 class="text-[1.1rem] font-normal tracking-[0.01em]">
          {{ $t('strikes.strikesHeading') }}
        </h3>
        <ul>
          <li
            v-for="(strike, i) in strikes?.filter(
              (s) =>
                s?.visible !== false &&
                (s?.ready ||
                  s?.item?.system?.equipped?.carryType === 'held' ||
                  s?.item === undefined)
            )"
            class="cursor-pointer pb-2"
            :key="strike.slug"
          >
            <StrikeActionSet
              type="strike"
              :id="i"
              :label="strike?.label ?? strike?.item?.name"
              :isRanged="(strike?.item?.system?.range ?? 0) > 0"
              :range="strike?.item?.system?.range"
              :mapLabelSet="strike.variants"
              @clicked="(_id, options) => pickStrike(options, i)"
            />
            <div v-for="(altUsage, j) in strike?.altUsages" :key="strike.slug + '_alt_' + j">
              <StrikeActionSet
                type="strike"
                :id="i"
                :label="altUsage?.item?.name ?? altUsage?.label"
                :isRanged="(altUsage?.item?.system?.range ?? 0) > 0"
                :range="altUsage?.item?.system?.range"
                :mapLabelSet="altUsage?.variants"
                @clicked="(_id, options) => pickStrike(options, i, j)"
              />
            </div>
          </li>
        </ul>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="strikeModal"
        :itemId="viewedItem?._id"
        :traits="viewedTraits"
        :rolls="strikeRolls"
        @closing="modifierOverrides = {}"
        :imageUrl="
          (viewed?.target.kind === 'blast' ? viewed.target.data.blastImg : undefined) ??
          viewedItem?.img ??
          'icons/skills/melee/unarmed-punch-fist.webp'
        "
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
          :damageTypeOptions="damageTypeOptions"
          :viewedDamageTypeSelected="viewedDamageTypeSelected"
          :blastActions="blastActions + ''"
          :isListening="isListening"
          :effectiveEnabled="effectiveEnabled"
          :isManuallyActivated="isManuallyActivated"
          :isManuallyDeactivated="isManuallyDeactivated"
          :isStackingLoser="isStackingLoser"
          :onToggleModifier="toggleModifier"
          :onToggleLoaded="toggleLoaded"
          :onUpdateDamageType="updateDamageType"
          :onSetBlastActions="setBlastActions"
        />
      </InfoModal>
    </Teleport>
  </div>
</template>
