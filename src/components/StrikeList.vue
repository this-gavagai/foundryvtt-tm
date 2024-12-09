<script setup lang="ts">
// TODO (bug): prevent strikeModal content from clearing until after animation is finished
// TODO (data): add reload action from pf2e-ranged?
// TODO (data): show range of weapons
// TODO (bug): damage doesn't load if the button is clicked really quickly after reload. Why?
// TODO (feature): allow player to choose two-action blasts somehow.
// TODO (feature): allow damage type to be selectable for blasts and versatile damage
// TODO (UX): add ranged/melee icon to list items, and get range details in there somehow
// TODO (bug): modifiers for blasts aren't always working right, missing item bonuses for example from gate attenuator
// TODO (bug): modifiers for blast damage aren't showing up at all

import { inject, ref, watch, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import { capitalize } from '@/utils/utilities'
import InfoModal from './InfoModal.vue'
import Button from '@/components/ButtonWidget.vue'
import StrikeActionSet from './StrikeActionSet.vue'
import type { Strike } from '@/composables/character'
import type { ElementalBlast } from '@/composables/character'
import type { Roll } from '@/types/foundry-types'

import bludgeoning from '@/assets/icons/thor-hammer.svg'
import slashing from '@/assets/icons/battle-axe.svg'
import piercing from '@/assets/icons/arrowhead.svg'

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
const { strikes, blasts } = character

const strikeModal = ref()
const strikeModalDamage = ref()
const strikeModalDetails = ref()
const viewedStrike = ref<Strike | ElementalBlast | undefined>()
const viewedStrikeOptions = ref<ViewedStrikeOptions | undefined>()

watch(
  viewedStrike,
  () => {
    console.log('changing!')
    const isStrike = viewedStrike.value?.hasOwnProperty('doStrike')
    strikeModalDetails.value = {
      img: isStrike
        ? ((viewedStrike.value as Strike)?.item?.img ??
          'icons/skills/melee/unarmed-punch-fist.webp')
        : (viewedStrike.value as ElementalBlast)?.img,
      traits: isStrike
        ? (viewedStrike.value as Strike)?.traits
            ?.map((t: Trait) => t.label)
            ?.concat((viewedStrike.value as Strike)?.weaponTraits?.map((t: Trait) => t.label) ?? [])
        : (viewedStrike.value as ElementalBlast)?.item?.system?.traits?.value, // TODO: add damage type to traits
      label: isStrike
        ? (viewedStrike.value as Strike)?.label
        : `Elemental Blast (${capitalize((viewedStrike.value as ElementalBlast)?.element)}) - ${viewedStrikeOptions.value?.melee ? 'Melee' : 'Ranged'}`,
      modifiers: isStrike
        ? (viewedStrike.value as Strike)?._modifiers
        : (viewedStrike.value as ElementalBlast)?.statistic?.modifiers, // TODO (bug): figure out why this is missing some modifiers like Attunement Gate items
      variantLabel: isStrike
        ? (viewedStrike.value as Strike)?.variants?.[viewedStrikeOptions.value?.subtype ?? 0]?.label
        : (viewedStrike.value as ElementalBlast)?.maps?.[
            strikeModal.value?.options?.melee ? 'melee' : ('ranged' as keyof object)
          ]?.[('map' + viewedStrikeOptions.value?.subtype) as keyof object],
      selectedDamageType: isStrike
        ? ((viewedStrike.value as Strike)?.item?.system?.traits?.toggles.modular?.selected ??
          (viewedStrike.value as Strike)?.item?.system?.traits?.toggles.versatile?.selected ??
          (viewedStrike.value as Strike)?.item?.system?.damage?.damageType)
        : null,
      strikeAction: isStrike
        ? () => (viewedStrike.value as Strike)?.doStrike?.(viewedStrikeOptions.value?.subtype ?? 0)
        : () =>
            (viewedStrike.value as ElementalBlast)?.doBlast?.(
              (viewedStrike.value as ElementalBlast)?.element ?? '',
              (viewedStrike.value as ElementalBlast)?.damageTypes[0].value ?? '', // TODO (feature): allow damage type to be selectable (see below)
              viewedStrikeOptions.value?.subtype ?? 0,
              viewedStrikeOptions.value?.melee ?? true
            ),
      damageAction: isStrike
        ? () => (viewedStrike.value as Strike)?.doDamage?.(strikeModal.value?.options?.subtype)
        : () =>
            (viewedStrike.value as ElementalBlast)?.doBlastDamage?.(
              (viewedStrike.value as ElementalBlast)?.element ?? '',
              (viewedStrike.value as ElementalBlast)?.damageTypes[0].value ?? '', // TODO (feature): allow damage type to be selectable (see above)
              viewedStrikeOptions.value?.subtype === 0 ? 'success' : 'criticalSuccess',
              viewedStrikeOptions.value?.melee ?? true
            )
    }
  },
  { deep: true }
)
watch(viewedStrike, async () => {
  const isStrike = viewedStrike.value?.hasOwnProperty('doStrike')
  if (isStrike) strikeModalDamage.value = await (viewedStrike.value as Strike)?.getDamage?.()
  else
    strikeModalDamage.value = await (viewedStrike.value as ElementalBlast)?.getBlastDamage?.(
      (viewedStrike.value as ElementalBlast)?.element ?? '',
      (viewedStrike.value as ElementalBlast)?.damageTypes[0].value ?? '', // TODO (feature): allow damage type to be selectable (see below),
      strikeModal.value?.options?.melee
    )
})
</script>
<template>
  <div class="break-inside-avoid px-6 py-4">
    <div class="break-inside-avoid [&:not(:has(li))]:hidden">
      <h3 class="text-lg underline">Elemental Blasts</h3>
      <ul>
        <li v-for="(blast, i) in blasts" class="cursor-pointer pb-2" :key="blast.element">
          <div v-for="attackType in ['melee', 'ranged']" :key="'at_' + attackType">
            <StrikeActionSet
              type="blast"
              :id="i"
              :isRanged="attackType === 'ranged'"
              :label="`Elemental Blast (${capitalize(blast.element)})`"
              :mapLabelSet="
                [
                  attackType === 'melee' ? blast?.maps?.melee?.map0 : blast?.maps?.ranged?.map0,
                  attackType === 'melee' ? blast?.maps?.melee?.map1 : blast?.maps?.ranged?.map1,
                  attackType === 'melee' ? blast?.maps?.melee?.map2 : blast?.maps?.ranged?.map2
                ].map((i) => ({ label: i }))
              "
              @clicked="
                (id, options) => {
                  viewedStrike = blast
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
    <div class="break-inside-avoid [&:not(:has(li))]:hidden [div_&]:pt-2">
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
                viewedStrike = strike
                viewedStrikeOptions = { ...options, strikeType: 'strike' }
                strikeModal.open()
              }
              // (id: string, options: object) =>
              //   strikeModal.open(id, { ...options, strikeType: 'strike' }, strike)
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
          <div class="mt-2 italic">Damage Type: {{ strikeModalDetails?.selectedDamageType }}</div>
          <span class="isolate mb-2 inline-flex rounded-md shadow-sm">
            <button
              type="button"
              class="relative inline-flex items-center bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
            >
              <img :src="bludgeoning" class="h-6" />
            </button>
            <button
              type="button"
              class="relative -ml-px inline-flex items-center bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
            >
              <img :src="piercing" class="h-6" />
            </button>
            <button
              type="button"
              class="relative -ml-px inline-flex items-center bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
            >
              <img :src="slashing" class="h-6" />
            </button>
          </span>
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
          type="button"
          color="blue"
          @click="
            strikeModalDetails?.strikeAction()?.then((r: Roll) => {
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
          type="button"
          :label="viewedStrikeOptions?.subtype ? 'Critical' : 'Damage'"
          color="red"
          @click="
            strikeModalDetails.damageAction()?.then((r: Roll) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        />
      </template>
    </InfoModal>
  </Teleport>
</template>
