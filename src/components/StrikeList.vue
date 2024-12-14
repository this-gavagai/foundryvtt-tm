<script setup lang="ts">
// TODO (feature): check pf2e AttackRollParams type to see if there's a better way to implement altUsage attacks/damage
// TODO (feature): implement getDamage and setDamageType for altUsage (if necessary?)
// TODO (feature): add reload action from pf2e-ranged?
// TODO (bug): modifiers for blasts aren't always working right, missing item bonuses for example from gate attenuator

import { inject, ref, watch, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import InfoModal from './InfoModal.vue'
import Button from '@/components/ButtonWidget.vue'
import StrikeActionSet from './StrikeActionSet.vue'
import type { Item } from '@/composables/character'
import type { Strike } from '@/composables/character'
import type { ElementalBlast } from '@/composables/character'

import ChoiceWidget from './ChoiceWidget.vue'

import action1 from '@/assets/icons/action1.svg'
import action2 from '@/assets/icons/action2.svg'
import bludgeoning from '@/assets/icons/thor-hammer.svg'
import slashing from '@/assets/icons/battle-axe.svg'
import piercing from '@/assets/icons/arrowhead.svg'
import electricity from '@/assets/icons/electric.svg'
import fire from '@/assets/icons/celebration-fire.svg'
import cold from '@/assets/icons/snowflake-2.svg'
import vitality from '@/assets/icons/hearts.svg'
const damageIcons = { bludgeoning, slashing, piercing, electricity, fire, cold, vitality }
const actionIcons = { '1': action1, '2': action2 }

interface Trait {
  label: string | undefined
}
interface ViewedStrikeOptions {
  melee?: boolean
  type?: 'strike' | 'strike_damage' | 'blast' | 'blast_damage'
  strikeType?: 'strike' | 'blast'
  attackType?: 'melee' | 'ranged'
  subtype?: number
  altUsage?: number | undefined
}

const character = inject(useKeys().characterKey)!
const { strikes, blasts, inventory, actions, blastActions } = character

const strikeModal = ref()
const strikeModalDamage = ref()
const viewedStrikeOptions = ref<ViewedStrikeOptions | undefined>()

const viewedStrikeId = ref<number | undefined>()
const viewedStrike = computed(() => {
  console.log('thing', viewedStrikeOptions.value?.altUsage)
  if (viewedStrikeId.value === undefined) return undefined
  return viewedStrikeOptions.value?.strikeType === 'strike'
    ? strikes.value?.[viewedStrikeId.value]
    : blasts.value?.[viewedStrikeId.value]
})

function getDamageTypes(item: Item | undefined) {
  const types = new Set()
  types.add(item?.system?.damage?.damageType)
  if (item?.system?.traits?.value?.includes('versatile-b')) types.add('bludgeoning')
  if (item?.system?.traits?.value?.includes('versatile-p')) types.add('piercing')
  if (item?.system?.traits?.value?.includes('versatile-s')) types.add('slashing')
  if (item?.system?.traits?.value?.includes('modular'))
    ['slashing', 'piercing', 'bludgeoning'].forEach((item) => types.add(item))
  return Array.from(types)
}

const strikeModalDetails = computed(() => {
  const isStrike = viewedStrike.value?.hasOwnProperty('weaponTraits')
  const item = isStrike
    ? inventory.value?.find((i) => i._id === viewedStrike.value?.item?._id)
    : actions.value?.find((i) => i._id === viewedStrike.value?.item?._id)
  const strikeOrAlt = isStrike
    ? viewedStrikeOptions.value?.altUsage === undefined
      ? viewedStrike.value
      : (viewedStrike.value as Strike)?.altUsages[viewedStrikeOptions.value.altUsage]
    : undefined

  return {
    img: isStrike
      ? (item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp')
      : (viewedStrike.value as ElementalBlast)?.img,
    traits: isStrike
      ? (strikeOrAlt as Strike)?.traits
          ?.map((t: Trait) => t.label)
          ?.concat((viewedStrike.value as Strike)?.weaponTraits?.map((t: Trait) => t.label) ?? [])
      : [
          ...(item?.system?.traits?.value ?? []),
          ...[
            item?.flags?.pf2e?.damageSelections?.[
              (viewedStrike.value as ElementalBlast)?.element as keyof object
            ]
          ].filter((i) => i && !['bludgeoning', 'piercing', 'slashing'].includes(i))
        ],
    label: isStrike
      ? (strikeOrAlt as Strike)?.label
      : `Elemental Blast (${(viewedStrike.value as ElementalBlast)?.element}) - ${viewedStrikeOptions.value?.melee ? 'Melee' : 'Ranged'}`,
    modifiers: isStrike
      ? (strikeOrAlt as Strike)?._modifiers
      : (viewedStrike.value as ElementalBlast)?.statistic?.modifiers,
    variantLabel: isStrike
      ? (strikeOrAlt as Strike)?.variants?.[viewedStrikeOptions.value?.subtype ?? 0]?.label
      : (viewedStrike.value as ElementalBlast)?.maps?.[
          strikeModal.value?.options?.melee ? 'melee' : ('ranged' as keyof object)
        ]?.[('map' + viewedStrikeOptions.value?.subtype) as keyof object],
    range: isStrike
      ? strikeOrAlt?.item?.system?.range
      : viewedStrikeOptions.value?.melee
        ? undefined
        : (viewedStrike.value as ElementalBlast)?.range?.max,
    damageTypeOptions: isStrike
      ? (getDamageTypes(item) as string[])
      : ((viewedStrike.value as ElementalBlast)?.damageTypes?.map((x) => x.value) as string[]),
    damageTypeSelected: isStrike
      ? (item?.system?.traits?.toggles.modular?.selected ??
        item?.system?.traits?.toggles.versatile?.selected ??
        item?.system?.damage?.damageType)
      : item?.flags?.pf2e?.damageSelections?.[
          (viewedStrike.value as ElementalBlast)?.element as keyof object
        ],
    strikeAction: isStrike
      ? () =>
          (viewedStrike.value as Strike)?.doStrike?.(
            viewedStrikeOptions.value?.subtype ?? 0,
            viewedStrikeOptions.value?.altUsage
          )
      : () => {
          const element = (viewedStrike.value as ElementalBlast)?.element ?? ''
          const damageType =
            viewedStrike.value?.item?.flags?.pf2e?.damageSelections?.[
              (viewedStrike.value as ElementalBlast)?.element as keyof object
            ] ??
            (viewedStrike.value as ElementalBlast).damageTypes[0].value ??
            ''
          return (viewedStrike.value as ElementalBlast)?.doBlast?.(
            element,
            damageType,
            viewedStrikeOptions.value?.subtype ?? 0,
            viewedStrikeOptions.value?.melee ?? true
          )
        },
    damageAction: isStrike
      ? () =>
          (viewedStrike.value as Strike)?.doDamage?.(
            viewedStrikeOptions.value?.subtype ?? 0,
            viewedStrikeOptions.value?.altUsage
          )
      : () => {
          const element = (viewedStrike.value as ElementalBlast)?.element ?? ''
          const damageType =
            viewedStrike.value?.item?.flags?.pf2e?.damageSelections?.[
              (viewedStrike.value as ElementalBlast)?.element as keyof object
            ] ??
            (viewedStrike.value as ElementalBlast).damageTypes[0].value ??
            ''
          return (viewedStrike.value as ElementalBlast)?.doBlastDamage?.(
            element,
            damageType,
            viewedStrikeOptions.value?.subtype === 0 ? 'success' : 'criticalSuccess',
            viewedStrikeOptions.value?.melee ?? true
          )
        }
  }
})
async function updateDamageFormula() {
  // strikeModalDamage.value = undefined
  const isStrike = viewedStrike.value?.hasOwnProperty('weaponTraits')
  if (isStrike) {
    strikeModalDamage.value = await (viewedStrike.value as Strike)?.getDamage?.()
  } else {
    const element = (viewedStrike.value as ElementalBlast)?.element ?? ''
    const damageType =
      viewedStrike.value?.item?.flags?.pf2e?.damageSelections?.[
        (viewedStrike.value as ElementalBlast)?.element as keyof object
      ] ??
      (viewedStrike.value as ElementalBlast).damageTypes[0].value ??
      ''
    strikeModalDamage.value = await (viewedStrike.value as ElementalBlast)?.getBlastDamage?.(
      element,
      damageType,
      strikeModal.value?.options?.melee
    )
  }
}
watch(viewedStrike, async () => {
  updateDamageFormula()
})
// window.smd = strikeModalDetails
</script>
<template>
  <div class="break-inside-avoid px-6 py-4 [&:not(:has(li))]:hidden">
    <div class="break-inside-avoid [&:not(:has(li))]:hidden">
      <h3 class="text-lg underline">Elemental Blasts</h3>
      <ul>
        <li v-for="(blast, i) in blasts" class="cursor-pointer pb-2" :key="blast.element">
          <div v-for="attackType in ['melee', 'ranged']" :key="'at_' + attackType">
            <StrikeActionSet
              type="blast"
              :id="i"
              :isRanged="attackType === 'ranged'"
              :range="attackType === 'ranged' ? blast?.range?.max : undefined"
              :label="`Elemental Blast (${blast.element})`"
              :mapLabelSet="
                [
                  attackType === 'melee' ? blast?.maps?.melee?.map0 : blast?.maps?.ranged?.map0,
                  attackType === 'melee' ? blast?.maps?.melee?.map1 : blast?.maps?.ranged?.map1,
                  attackType === 'melee' ? blast?.maps?.melee?.map2 : blast?.maps?.ranged?.map2
                ].map((i) => ({ label: i }))
              "
              @clicked="
                (id, options) => {
                  viewedStrikeId = i
                  viewedStrikeOptions = {
                    ...options,
                    strikeType: 'blast',
                    melee: attackType === 'melee'
                  }
                  strikeModal.open()
                }
              "
            />
          </div>
        </li>
      </ul>
    </div>
    <div class="break-inside-avoid [&:not(:has(li))]:hidden [div_&:not(:hidden)]:pt-2">
      <h3 class="text-lg underline">Strikes</h3>
      <ul>
        <li
          v-for="(strike, i) in strikes?.filter(
            (s) => s?.item?.system?.equipped?.carryType === 'held' || s?.item === undefined
          )"
          class="cursor-pointer pb-2"
          :key="strike.slug"
        >
          <StrikeActionSet
            type="strike"
            :id="i"
            :label="strike?.item?.name ?? strike?.label"
            :isRanged="strike?.item?.system?.range ?? NaN > 0"
            :range="strike?.item?.system?.range"
            :mapLabelSet="strike.variants"
            @clicked="
              (id: string, options: object) => {
                viewedStrikeId = i
                viewedStrikeOptions = { ...options, strikeType: 'strike' }
                strikeModal.open()
              }
            "
          />
          <div v-for="(altUsage, j) in strike?.altUsages" :key="strike.slug + '_alt_' + j">
            <StrikeActionSet
              type="strike"
              :id="i"
              :label="altUsage?.item?.name ?? altUsage?.label"
              :isRanged="altUsage?.item?.system?.range ?? NaN > 0"
              :range="altUsage?.item?.system?.range"
              :mapLabelSet="altUsage?.variants"
              @clicked="
                (id: string, options: object) => {
                  viewedStrikeId = i
                  viewedStrikeOptions = { ...options, strikeType: 'strike', altUsage: j }
                  strikeModal.open()
                }
              "
            />
          </div>
        </li>
      </ul>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="strikeModal"
      :traits="strikeModalDetails?.traits"
      :imageUrl="strikeModalDetails?.img"
    >
      <template #title>{{ strikeModalDetails?.label }}</template>
      <template #description>{{
        viewedStrikeOptions?.type?.match('_damage') && viewedStrikeOptions?.subtype === 1
          ? strikeModalDamage?.response?.critical
          : strikeModalDamage?.response?.damage
      }}</template>
      <template #default>
        <div v-if="strikeModalDetails?.range">Range: {{ strikeModalDetails?.range }} ft.</div>
        <div class="flex justify-end gap-2">
          <ChoiceWidget
            label="Damage Type:"
            :choiceSet="strikeModalDetails?.damageTypeOptions ?? []"
            :iconSet="damageIcons"
            :selected="strikeModalDetails?.damageTypeSelected ?? ''"
            :clicked="
              (damageType) => {
                if (damageType !== strikeModalDetails?.damageTypeSelected) {
                  return viewedStrike?.setDamageType?.(damageType)?.then((r) => {
                    updateDamageFormula()
                  })
                }
              }
            "
          />
          <ChoiceWidget
            v-if="viewedStrikeOptions?.type?.match('blast')"
            :choiceSet="['1', '2']"
            :iconSet="actionIcons"
            :selected="blastActions + ''"
            :clicked="(newChoice) => (blastActions = newChoice)"
          />
        </div>
        <ul>
          <li
            v-for="mod in viewedStrikeOptions?.type?.match('_damage')
              ? strikeModalDamage?.response?.modifiers
              : strikeModalDetails?.modifiers"
            class="flex gap-2"
            :class="{ 'text-gray-300': !mod.enabled }"
            :key="mod.slug"
          >
            <div class="w-8 text-right">
              {{ formatModifier(mod.modifier) }}
            </div>
            <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
          </li>
        </ul>
      </template>
      <template #actionButtons>
        <Button
          v-if="viewedStrikeOptions?.type === 'strike' || viewedStrikeOptions?.type === 'blast'"
          color="blue"
          :clicked="
            () =>
              strikeModalDetails?.strikeAction()?.then((r) => {
                strikeModal.close()
                strikeModal.rollResultModal.open(r)
              })
          "
        >
          <span v-if="!viewedStrikeOptions?.subtype">Strike&nbsp;</span>
          <span>{{ strikeModalDetails?.variantLabel }}</span>
        </Button>
        <Button
          v-if="viewedStrikeOptions?.type?.match('_damage')"
          :label="viewedStrikeOptions?.subtype ? 'Critical' : 'Damage'"
          color="red"
          :clicked="
            () =>
              strikeModalDetails.damageAction()?.then((r) => {
                strikeModal.close()
                strikeModal.rollResultModal.open(r)
              })
          "
        />
      </template>
    </InfoModal>
  </Teleport>
</template>
