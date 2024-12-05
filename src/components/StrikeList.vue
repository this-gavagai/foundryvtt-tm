<script setup lang="ts">
// TODO: (feature) handle versatile damage types
// TODO: (UX) Improve dice representations for damage rolls (number and types)
// TODO: use button widget
// TODO: add reload action from pf2e-ranged?
// TODO: show range of weapons
// TODO: fix strike buttons so that damage line-breaks together
// TODO: make strike buttons

import { inject, ref, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import InfoModal from './InfoModal.vue'

interface Trait {
  label: string | undefined
}

const strikeModal = ref()

const character = inject(useKeys().characterKey)!
const { strikes } = character

const viewedItem = computed(() => strikes.value?.[strikeModal.value?.itemId])
</script>
<template>
  <div class="px-6 [&:not(:has(li))]:hidden">
    <h3 class="py-2 text-lg underline">Strikes</h3>
    <ul>
      <li
        v-for="(strike, i) in strikes?.filter(
          (s) => s?.item?.system?.equipped?.carryType === 'held' || s?.item === undefined
        )"
        class="cursor-pointer pb-2 text-xl"
        :key="strike.slug"
      >
        <!-- <div class="text-xs border p-1 w-8 mr-1 text-right">
          {{ SignedNumber.format(strike?.totalModifier) }}
        </div> -->
        <div>{{ strike?.item?.name ?? strike?.label }}</div>
        <div class="flex flex-wrap leading-9">
          <span>
            <span
              v-for="(variant, index) in strike.variants"
              class="mb-1 mr-1 break-inside-avoid border bg-blue-500 p-2 text-xs text-white hover:bg-blue-400"
              @click="strikeModal.open(i, { type: 'strike', subtype: index })"
              :key="'variant_' + index"
            >
              <span v-if="!index" class="pf2-icon h-0 pr-2 pt-1 text-lg leading-none">1</span>
              <span v-if="!index">Strike </span>
              <span>{{ variant.label }}</span>
            </span>
          </span>
          <!-- </div> -->
          <!-- <div class="mt-2"> -->
          <span class="mb-1">
            <span
              class="mb-1 mr-1 break-inside-avoid border bg-red-500 p-2 text-xs text-white hover:bg-red-400"
              @click="strikeModal.open(i, { type: 'damage', subtype: 0 })"
              >Damage</span
            >
            <span
              class="mb-1 mr-1 break-inside-avoid border bg-red-500 p-2 text-xs text-white hover:bg-red-400"
              @click="strikeModal.open(i, { type: 'damage', subtype: 1 })"
              >Critical</span
            >
          </span>
        </div>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="strikeModal"
      :traits="
        viewedItem?.traits
          ?.map((t: Trait) => t.label)
          ?.concat(viewedItem?.weaponTraits?.map((t: Trait) => t.label) ?? [])
      "
      :imageUrl="viewedItem?.item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp'"
    >
      <template #title>{{ viewedItem?.label }}</template>
      <template #description>{{
        strikeModal.options.subtype === 0
          ? viewedItem?.tmDamageFormula?.base
          : viewedItem?.tmDamageFormula?.critical
      }}</template>
      <template #default>
        <ul>
          <li
            v-for="mod in strikeModal.options?.type === 'damage'
              ? viewedItem?.tmDamageFormula?._modifiers
              : viewedItem?._modifiers"
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
        <button
          v-if="strikeModal.options?.type === 'strike'"
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none"
          @click="
            viewedItem?.doStrike?.(strikeModal.options.subtype)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        >
          <span v-if="!strikeModal.options.subtype">Strike &nbsp;</span>
          <span>{{ viewedItem?.variants?.[strikeModal.options.subtype].label }}</span>
        </button>

        <button
          v-if="strikeModal.options?.type === 'damage' && strikeModal.options.subtype === 0"
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus:outline-none"
          @click="
            viewedItem?.doDamage?.(strikeModal.options.subtype)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        >
          Damage
        </button>
        <button
          v-if="strikeModal.options?.type === 'damage' && strikeModal.options.subtype === 1"
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus:outline-none"
          @click="
            viewedItem?.doDamage?.(strikeModal.options.subtype)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        >
          Critical
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
