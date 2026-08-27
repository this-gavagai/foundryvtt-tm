<script setup lang="ts">
import type { Spell, SpellcastingEntry, Modifier } from '@/composables/character'
import type { Roll } from '@/types/roll-types'
import type { RequestResolutionArgs } from '@/types/api-types'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { useSpellVariantMemory } from '@/composables/useSpellVariantMemory'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'
import type { SpellVariant } from '@/utils/spellVariants'

import InfoModal from '@/components/InfoModal.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'

// The spell attack/damage roll modal, lifted out of SpellList. Opened
// imperatively via open() when a spell's attack or damage chip is picked; owns
// its own modifier overrides and the rank-aware damage-formula fetch. Fully
// self-contained — the spell object carries its own doSpellAttack/doSpellDamage/
// getDamage, so nothing but that object and the roll parameters comes in.

const { t } = useI18n()
const { isListening } = storeToRefs(useListenersStore())

interface SpellRollView {
  spell: Spell
  entry?: SpellcastingEntry
  castingRank?: number
  phase: 'attack' | 'damage'
  map: 0 | 1 | 2
}

const modal = ref<InstanceType<typeof InfoModal>>()
const viewedSpellRoll = ref<SpellRollView | undefined>()
const spellRollDamageData = ref<
  { formula?: string | null; breakdown?: string[]; modifiers?: Modifier[] } | undefined
>()

// Which variant THIS roll is made as. Independent of the variant the spell was
// cast as — Foundry draws no link either — but seeded from whatever was last
// used for this spell so the common case needs no picking. See
// useSpellVariantMemory.
const { rememberVariant, lastVariant } = useSpellVariantMemory()
const variantChoice = ref<string | undefined>()
const spellVariantOptions = computed<SpellVariant[]>(
  () => viewedSpellRoll.value?.spell?.system?.variants ?? []
)
const selectedVariant = computed(
  () =>
    variantChoice.value ??
    lastVariant(viewedSpellRoll.value?.spell?._id, spellVariantOptions.value) ??
    spellVariantOptions.value[0]?.overlayId ??
    ''
)
const spellVariantLabels = computed(() =>
  Object.fromEntries(spellVariantOptions.value.map((v) => [v.overlayId, v.label]))
)
const spellVariantGlyphs = computed(() =>
  Object.fromEntries(spellVariantOptions.value.map((v) => [v.overlayId, v.actionGlyph ?? '']))
)

// Only send overlays for a spell that actually offers a choice; a plain spell
// must roll exactly as it did before.
function rollOverlayIds(): string[] | undefined {
  return spellVariantOptions.value.length > 1 && selectedVariant.value
    ? [selectedVariant.value]
    : undefined
}

// Remember on USE, not on selection: flipping through variants to compare
// numbers in the preview is browsing, and must not change what the next cast
// defaults to.
function rememberRolledVariant() {
  if (spellVariantOptions.value.length > 1) {
    rememberVariant(viewedSpellRoll.value?.spell?._id, selectedVariant.value)
  }
}

const spellRollModifiers = computed(() =>
  viewedSpellRoll.value?.phase === 'attack'
    ? viewedSpellRoll.value.entry?.spellAttackModifiers
    : spellRollDamageData.value?.modifiers
)

const {
  modifierOverrides: spellRollModifierOverrides,
  toggleModifier: toggleSpellRollModifier,
  effectiveEnabled: spellRollEffectiveEnabled,
  isManuallyActivated: isSpellRollManuallyActivated,
  isManuallyDeactivated: isSpellRollManuallyDeactivated,
  isStackingLoser: isSpellRollStackingLoser
} = useModifierOverrides(spellRollModifiers)

function spellRollModifierOverridePayload() {
  const overrides = spellRollModifierOverrides.value
  return Object.keys(overrides).length ? { ...overrides } : undefined
}

function open(
  spell: Spell,
  entry: SpellcastingEntry | undefined,
  castingRank: number | undefined,
  phase: 'attack' | 'damage',
  map: 0 | 1 | 2
) {
  viewedSpellRoll.value = { spell, entry, castingRank, phase, map }
  spellRollDamageData.value = undefined
  spellRollModifierOverrides.value = {}
  variantChoice.value = undefined
  modal.value?.open()
}

defineExpose({ open })

// Fetch the damage formula whenever the modal enters damage phase. The formula
// is rank-aware (heightening), so re-fetch on rank changes too.
watch([viewedSpellRoll, spellRollModifierOverrides, selectedVariant], async ([v]) => {
  if (!v || v.phase !== 'damage' || !isListening.value) {
    spellRollDamageData.value = undefined
    return
  }
  const overrides = spellRollModifierOverridePayload()
  const overrideKey = JSON.stringify(overrides ?? {})
  const variantKey = selectedVariant.value
  const result = (await v.spell.getDamage?.(v.castingRank, overrides, rollOverlayIds())) as
    | (RequestResolutionArgs & {
        response?: { formula?: string | null; breakdown?: string[]; modifiers?: Modifier[] }
      })
    | null
  // The fetch is async; if the viewed roll changed while it was in flight, a
  // stale response must not overwrite the current one.
  if (
    viewedSpellRoll.value !== v ||
    JSON.stringify(spellRollModifierOverridePayload() ?? {}) !== overrideKey ||
    selectedVariant.value !== variantKey
  )
    return
  spellRollDamageData.value = result?.response
})

const spellRollDamageDice = computed<string[]>(() => {
  const f = spellRollDamageData.value?.formula
  return f ? parseDamageFormulaDice(f) : []
})

function attackNumberForMap(m: 0 | 1 | 2): 1 | 2 | 3 {
  return (m + 1) as 1 | 2 | 3
}

const spellRollRolls = computed<Roll[]>(() => {
  const v = viewedSpellRoll.value
  if (!v || !isListening.value) return []
  if (v.phase === 'attack') {
    const suffix = v.map === 0 ? '' : v.map === 1 ? ' -5' : ' -10'
    return [
      {
        key: 'spell-attack',
        label: t('spells.attack') + suffix,
        color: 'blue',
        dice: ['d20'],
        armed: true,
        execute: (faces) => {
          rememberRolledVariant()
          return v.spell.doSpellAttack!(
            attackNumberForMap(v.map),
            faces?.[0],
            spellRollModifierOverridePayload(),
            rollOverlayIds()
          )
        }
      }
    ]
  }
  const dice = spellRollDamageDice.value
  return [
    {
      key: 'spell-damage',
      label: t('spells.damage'),
      color: 'red',
      dice: dice.length ? dice : undefined,
      execute: (faces) => {
        rememberRolledVariant()
        return v.spell.doSpellDamage!(
          v.map,
          v.castingRank,
          faces && dice.length ? makeDiceResults(dice, faces) : undefined,
          spellRollModifierOverridePayload(),
          rollOverlayIds()
        )
      }
    }
  ]
})
</script>
<template>
  <InfoModal
    ref="modal"
    :itemId="viewedSpellRoll?.spell?._id"
    :imageUrl="viewedSpellRoll?.spell?.img"
    :traits="viewedSpellRoll?.spell?.system?.traits?.value"
    :rolls="spellRollRolls"
    @closing="spellRollModifierOverrides = {}"
  >
    <template #title>
      {{ viewedSpellRoll?.spell?.name }}
      <ActionIcons
        v-if="viewedSpellRoll?.spell"
        class="relative -mt-2 pl-1 text-2xl leading-4"
        :actions="viewedSpellRoll?.spell?.system?.time?.value"
      />
    </template>
    <template #description>
      <span v-if="viewedSpellRoll?.phase === 'attack'">
        {{ $t('spells.spellAttack') }}
        <span v-if="viewedSpellRoll?.entry?.spellAttackModifier != null">
          {{ viewedSpellRoll?.entry?.spellAttackModifier >= 0 ? '+' : ''
          }}{{ viewedSpellRoll?.entry?.spellAttackModifier }}
        </span>
        <span v-if="viewedSpellRoll?.map" class="ml-1 text-sm">
          ({{ viewedSpellRoll.map === 1 ? '-5' : '-10' }})
        </span>
      </span>
      <span v-else-if="viewedSpellRoll?.phase === 'damage'">
        {{ $t('spells.damage') }}
        <span v-if="viewedSpellRoll?.castingRank" class="ml-1 text-sm">
          ({{ $t('spells.rank', { n: viewedSpellRoll.castingRank }) }})
        </span>
      </span>
    </template>
    <template #body>
      <!-- Which variant this roll is made as. Independent of the cast — see
           useSpellVariantMemory — so switching here changes the formula and the
           dice the picker offers, without touching anything already cast. -->
      <ChoiceWidget
        v-if="viewedSpellRoll"
        class="mb-3 w-full"
        direction="column"
        :choiceSet="spellVariantOptions.map((v) => v.overlayId)"
        :labelSet="spellVariantLabels"
        :glyphSet="spellVariantGlyphs"
        :selected="selectedVariant"
        @changed="(id: string) => (variantChoice = id)"
      />
      <ModifierOverrideList
        :modifiers="spellRollModifiers"
        :toggleable="viewedSpellRoll?.phase === 'attack' || viewedSpellRoll?.phase === 'damage'"
        showDamageType
        :showAll="viewedSpellRoll?.phase === 'damage'"
        :effectiveEnabled="spellRollEffectiveEnabled"
        :isManuallyActivated="isSpellRollManuallyActivated"
        :isManuallyDeactivated="isSpellRollManuallyDeactivated"
        :isStackingLoser="isSpellRollStackingLoser"
        :onToggle="toggleSpellRollModifier"
      />
      <template v-if="viewedSpellRoll?.phase === 'damage'">
        <div v-if="spellRollDamageData?.formula" class="font-mono text-sm">
          {{ spellRollDamageData.formula }}
        </div>
        <ul class="mt-2">
          <li
            v-for="(line, i) in spellRollDamageData?.breakdown ?? []"
            class="text-sm"
            :key="'breakdown_' + i"
          >
            {{ line }}
          </li>
        </ul>
      </template>
    </template>
  </InfoModal>
</template>
