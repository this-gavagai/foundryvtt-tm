<script setup lang="ts">
// TODO (feature): add altUsage features (see pf2e AttackRollParams type)
// TODO (feature): add reload action from pf2e-ranged?
// TODO (data): show range of weapons
// TODO (UX): add ranged/melee icon to list items, and get range details in there somehow
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
}

const character = inject(useKeys().characterKey)!
const { strikes, blasts, inventory, actions, blastActions } = character

const strikeModal = ref()
const strikeModalDamage = ref()
// const viewedStrike = ref<Strike | ElementalBlast | undefined>()
const viewedStrikeOptions = ref<ViewedStrikeOptions | undefined>()
const damageTypeChoiceWidget = ref()
const actionCountChoiceWidget = ref()

const viewedStrikeId = ref<number | undefined>()
const viewedStrike = computed(() => {
  console.log('hey there', viewedStrikeId.value)
  if (viewedStrikeId.value === undefined) return undefined
  const correctOne =
    viewedStrikeOptions.value?.strikeType === 'strike'
      ? strikes.value?.[viewedStrikeId.value]
      : blasts.value?.[viewedStrikeId.value]
  console.log(correctOne)
  return correctOne
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
  const isStrike = viewedStrike.value?.hasOwnProperty('doStrike')
  const item = isStrike
    ? inventory.value?.find((i) => i._id === viewedStrike.value?.item?._id)
    : actions.value?.find((i) => i._id === viewedStrike.value?.item?._id)

  return {
    img: isStrike
      ? (item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp')
      : (viewedStrike.value as ElementalBlast)?.img,
    traits: isStrike
      ? (viewedStrike.value as Strike)?.traits
          ?.map((t: Trait) => t.label)
          ?.concat((viewedStrike.value as Strike)?.weaponTraits?.map((t: Trait) => t.label) ?? [])
      : // TODO: add damage type to traits
        item?.system?.traits?.value,
    label: isStrike
      ? (viewedStrike.value as Strike)?.label
      : `Elemental Blast (${(viewedStrike.value as ElementalBlast)?.element}) - ${viewedStrikeOptions.value?.melee ? 'Melee' : 'Ranged'}`,
    modifiers: isStrike
      ? (viewedStrike.value as Strike)?._modifiers
      : // TODO (bug): figure out why this is missing some modifiers like Attunement Gate items
        (viewedStrike.value as ElementalBlast)?.statistic?.modifiers,
    variantLabel: isStrike
      ? (viewedStrike.value as Strike)?.variants?.[viewedStrikeOptions.value?.subtype ?? 0]?.label
      : (viewedStrike.value as ElementalBlast)?.maps?.[
          strikeModal.value?.options?.melee ? 'melee' : ('ranged' as keyof object)
        ]?.[('map' + viewedStrikeOptions.value?.subtype) as keyof object],
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
      ? () => (viewedStrike.value as Strike)?.doStrike?.(viewedStrikeOptions.value?.subtype ?? 0)
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
      ? () => (viewedStrike.value as Strike)?.doDamage?.(strikeModal.value?.options?.subtype)
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
  const isStrike = viewedStrike.value?.hasOwnProperty('doStrike')
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
            :mapLabelSet="strike.variants"
            @clicked="
              (id: string, options: object) => {
                viewedStrikeId = i
                viewedStrikeOptions = { ...options, strikeType: 'strike' }
                strikeModal.open()
              }
            "
          />
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
        <div class="flex justify-end gap-2">
          <ChoiceWidget
            ref="damageTypeChoiceWidget"
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
            ref="actionCountChoiceWidget"
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
