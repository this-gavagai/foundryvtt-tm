<script setup lang="ts">
import type { Modifier } from '@/composables/character'
import type { Roll } from '@/types/roll-types'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import type { CardRoll } from '@/utils/foundryHtml'
import type { SpellCardCast } from '@/composables/useChatMessages'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useInjectedActor } from '@/composables/injectKeys'
import { useModifierOverrides } from '@/composables/useModifierOverrides'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'
import { getSpellDamage, getStrikeDamage, rollCheck } from '@/api/actionRpc'

import InfoModal from '@/components/InfoModal.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'

// Attack/damage rolls launched from a POSTED chat card — a spell card's own
// buttons, or a strike card's — as opposed to the same rolls launched from the
// sheet by SpellRollModal / StrikeList.
//
// This can't share an implementation with those, because it rolls a different
// thing. The sheet hands its modal a Spell or Strike object whose roll methods
// always address the base item. A card's buttons have to roll what the CARD
// records: for a spell, the rank and the variant overlays a variant button
// applied (see spellCardCast); for a strike, the specific melee-or-ranged usage
// named in the card's own data-identifier. Both are carried in the descriptor
// the parser produces and forwarded to the module, which resolves them against
// live actor data rather than trusting a mirror.
//
// It also stays deliberately lean on chrome: the card the user just tapped is
// still on screen above the modal, so repeating its art and traits would add
// nothing.

const { t } = useI18n()
const { isListening } = storeToRefs(useListenersStore())
const { _actor, spellcastingEntries } = useInjectedActor()

interface CardRollView {
  roll: CardRoll
  // Present for spell rolls only; a strike names itself on the card.
  cast?: SpellCardCast
  title: string
}

interface DamagePreview {
  formula?: string | null
  breakdown?: string[]
  modifiers?: Modifier[]
}

const modal = ref<InstanceType<typeof InfoModal>>()
const view = ref<CardRollView | undefined>()
const damageData = ref<DamagePreview | undefined>()

const entry = computed(() =>
  spellcastingEntries?.value?.find((e) => e._id === view.value?.cast?.entryId)
)

// Attack-phase modifiers are only listable for spells: they come off the
// spellcasting entry, which the shared actor model exposes. The equivalent for
// a strike lives on the sheet's strike list, which chat has no access to — so a
// strike card's attack shows no override list. The ROLL is unaffected; PF2e
// applies every modifier either way, they just can't be toggled from here.
const rollModifiers = computed(() =>
  view.value?.roll.phase === 'attack'
    ? view.value.roll.kind === 'spell'
      ? entry.value?.spellAttackModifiers
      : undefined
    : damageData.value?.modifiers
)

const {
  modifierOverrides,
  toggleModifier,
  effectiveEnabled,
  isManuallyActivated,
  isManuallyDeactivated,
  isStackingLoser
} = useModifierOverrides(rollModifiers)

function overridePayload() {
  const overrides = modifierOverrides.value
  return Object.keys(overrides).length ? { ...overrides } : undefined
}

function withOverrides() {
  const overrides = overridePayload()
  return overrides ? { modifierOverrides: overrides } : {}
}

function open(roll: CardRoll, title: string, cast?: SpellCardCast) {
  view.value = { roll, cast, title }
  damageData.value = undefined
  modifierOverrides.value = {}
  modal.value?.open()
}

defineExpose({ open })

// Damage preview, fetched for the same subject the roll will use — a spell card
// switched to "Heal (vs. Living)" heals for more than the base spell, and a
// thrown weapon's ranged usage can differ from its melee one. Without that the
// dice picker would offer the wrong dice.
async function fetchDamagePreview(v: CardRollView): Promise<DamagePreview | undefined> {
  const overrides = overridePayload()
  if (v.roll.kind === 'spell') {
    if (!v.cast) return undefined
    const result = (await getSpellDamage(
      _actor,
      v.cast.spellId,
      v.cast.castRank,
      overrides,
      v.cast.overlayIds
    )) as RequestResolutionArgs & { response?: DamagePreview }
    return result?.response
  }
  const { strike } = v.roll
  const result = (await getStrikeDamage(
    _actor,
    strike.actionSlug,
    undefined,
    overrides,
    undefined,
    { itemId: strike.itemId, usage: strike.usage }
  )) as RequestResolutionArgs & {
    response?: { damage?: string; critical?: string; modifiers?: Modifier[] }
  }
  const response = result?.response
  if (!response) return undefined
  // The strike preview returns both outcomes; show the one this button rolls.
  const critical = v.roll.phase === 'damage' && v.roll.critical
  return {
    formula: (critical ? response.critical : response.damage) ?? null,
    breakdown: [],
    modifiers: response.modifiers
  }
}

watch([view, modifierOverrides], async ([v]) => {
  if (!v || v.roll.phase !== 'damage' || !isListening.value) {
    damageData.value = undefined
    return
  }
  const overrideKey = JSON.stringify(overridePayload() ?? {})
  const preview = await fetchDamagePreview(v)
  // The fetch is async; a response for a roll the user has already navigated
  // away from must not overwrite the current one.
  if (view.value !== v || JSON.stringify(overridePayload() ?? {}) !== overrideKey) return
  damageData.value = preview
})

const damageDice = computed<string[]>(() => {
  const formula = damageData.value?.formula
  return formula ? parseDamageFormulaDice(formula) : []
})

const mapSuffix = (variant: 0 | 1 | 2) => (variant === 0 ? '' : variant === 1 ? ' -5' : ' -10')

const rolls = computed<Roll[]>(() => {
  const v = view.value
  if (!v || !isListening.value) return []
  const roll = v.roll

  if (roll.phase === 'attack') {
    return [
      {
        key: `card:${roll.kind}-attack`,
        label:
          (roll.kind === 'spell' ? t('spells.attack') : t('strikes.strike')) +
          mapSuffix(roll.variant),
        color: 'blue',
        dice: ['d20'],
        armed: true,
        execute: (faces) =>
          roll.kind === 'spell'
            ? rollCheck(
                _actor,
                'spellAttack',
                {
                  entryId: v.cast?.entryId ?? '',
                  spellId: v.cast?.spellId,
                  // attackNumber is 1-based where the variant index is 0-based.
                  attackNumber: roll.variant + 1,
                  castingRank: v.cast?.castRank,
                  overlayIds: v.cast?.overlayIds
                },
                { d20: [faces?.[0] ?? 0] },
                [],
                withOverrides()
              )
            : rollCheck(
                _actor,
                'strike',
                {
                  actionSlug: roll.strike.actionSlug,
                  variant: roll.variant,
                  itemId: roll.strike.itemId,
                  usage: roll.strike.usage
                },
                { d20: [faces?.[0] ?? 0] },
                [],
                withOverrides()
              )
      }
    ]
  }

  const dice = damageDice.value
  const diceResults = (faces?: number[]) =>
    faces && dice.length ? (makeDiceResults(dice, faces) as DiceResults) : {}
  return [
    {
      key: `card:${roll.kind}-damage`,
      label: roll.kind === 'strike' && roll.critical ? t('strikes.critical') : t('spells.damage'),
      color: 'red',
      dice: dice.length ? dice : undefined,
      execute: (faces) =>
        roll.kind === 'spell'
          ? rollCheck(
              _actor,
              'spellDamage',
              {
                spellId: v.cast?.spellId ?? '',
                mapIncreases: 0,
                castingRank: v.cast?.castRank,
                overlayIds: v.cast?.overlayIds
              },
              diceResults(faces),
              [],
              withOverrides()
            )
          : rollCheck(
              _actor,
              'damage',
              {
                actionSlug: roll.strike.actionSlug,
                degree: roll.critical ? 'critical' : 'damage',
                itemId: roll.strike.itemId,
                usage: roll.strike.usage
              },
              diceResults(faces),
              [],
              withOverrides()
            )
    }
  ]
})
</script>

<template>
  <InfoModal ref="modal" :rolls="rolls" @closing="modifierOverrides = {}">
    <template #title>
      {{ view?.title }}
    </template>
    <template #description>
      <span v-if="view?.roll.phase === 'attack'">
        {{ view.roll.kind === 'spell' ? $t('spells.spellAttack') : $t('strikes.strike') }}
        <span v-if="view.roll.kind === 'spell' && entry?.spellAttackModifier != null">
          {{ entry.spellAttackModifier >= 0 ? '+' : '' }}{{ entry.spellAttackModifier }}
        </span>
        <span v-if="view.roll.variant" class="ml-1 text-sm">
          ({{ view.roll.variant === 1 ? '-5' : '-10' }})
        </span>
      </span>
      <span v-else>
        {{
          view?.roll.kind === 'strike' && view.roll.critical
            ? $t('strikes.critical')
            : $t('spells.damage')
        }}
        <span v-if="view?.cast?.castRank" class="ml-1 text-sm">
          ({{ $t('spells.rank', { n: view.cast.castRank }) }})
        </span>
      </span>
    </template>
    <template #body>
      <ModifierOverrideList
        :modifiers="rollModifiers"
        toggleable
        showDamageType
        :showAll="view?.roll.phase === 'damage'"
        :effectiveEnabled="effectiveEnabled"
        :isManuallyActivated="isManuallyActivated"
        :isManuallyDeactivated="isManuallyDeactivated"
        :isStackingLoser="isStackingLoser"
        :onToggle="toggleModifier"
      />
      <template v-if="view?.roll.phase === 'damage'">
        <div v-if="damageData?.formula" class="font-mono text-sm">
          {{ damageData.formula }}
        </div>
        <ul class="mt-2">
          <li
            v-for="(line, i) in damageData?.breakdown ?? []"
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
