<script setup lang="ts">
// TODO: handle versatile damage types
// TODO: (big feature) show damage modifiers in place of strike modifiers (can be down with "createMessage: false" prop on context object)
// TODO: Improve dice representations for damage rolls (number and types)
import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, ref, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import InfoModal from './InfoModal.vue'
const strikeModal = ref()
const actor = inject(useKeys().actorKey)!
const { rollCheck } = useApi()
const viewedItem = computed(() => actor.value?.system?.actions?.[strikeModal.value?.itemId])

function doStrike(slug: string) {
  if (actor.value)
    rollCheck(actor as Ref<Actor>, 'strike', slug).then((r) => {
      strikeModal.value.close()
      strikeModal.value.rollResultModal.open(r)
    })
}
function doDamage(slug: string, crit: number) {
  console.log('crit?', crit)
  if (actor.value)
    rollCheck(actor as Ref<Actor>, 'damage', `${slug},${crit ? 'critical' : 'damage'}`).then(
      (r) => {
        strikeModal.value.close()
        strikeModal.value.rollResultModal.open(r)
        console.log(r)
      }
    )
}
</script>
<template>
  <div class="px-6">
    <h3 class="underline text-2xl py-2">Strikes</h3>
    <ul>
      <li
        v-for="(strike, i) in actor?.system?.actions
          ?.filter((a: any) => a?.type === 'strike')
          .map((a: any) => {
            a['item'] = actor?.items?.find((i: Item) => i.system?.slug === a?.slug)
            return a
          })
          .filter(
            (a: any) => a.item?.system?.equipped?.carryType === 'held' || a.item === undefined
          )"
        class="cursor-pointer text-xl pb-2"
      >
        <!-- <div class="text-xs border p-1 w-8 mr-1 text-right">
          {{ SignedNumber.format(strike?.totalModifier) }}
        </div> -->
        <div>{{ strike?.item?.name ?? strike?.label }}</div>
        <div>
          <span
            v-for="(variant, index) in strike.variants"
            class="border p-2 mr-1 text-xs bg-blue-600 hover:bg-blue-500 text-white"
            @click="strikeModal.open(i, { type: 'strike', subtype: index })"
          >
            <span v-if="!index" class="pf2-icon text-lg pr-1">1</span>
            <span v-if="!index">Strike </span>
            <span>{{ variant.label }}</span>
          </span>
        </div>
        <div class="text-white mt-2">
          <span
            class="border p-2 mr-1 text-xs bg-red-600 hover:bg-red-500"
            @click="strikeModal.open(i, { type: 'damage', subtype: 0 })"
            >Damage</span
          >
          <span
            class="border p-2 mr-1 text-xs bg-red-600 hover:bg-red-500"
            @click="strikeModal.open(i, { type: 'damage', subtype: 1 })"
            >Critical</span
          >
        </div>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="strikeModal"
      :traits="
        viewedItem?.traits
          .map((t: any) => t.label)
          .concat(viewedItem?.weaponTraits.map((t: any) => t.label))
      "
      :imageUrl="viewedItem?.item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp'"
    >
      <template #title>{{ viewedItem?.label }}</template>
      <template #description>{{ viewedItem?.tmDamageFormula.base }}</template>
      <template #default>
        <ul>
          <li
            v-for="mod in viewedItem?._modifiers"
            class="flex gap-2"
            :class="{ 'text-gray-300': !mod.enabled }"
          >
            <div class="w-8 text-right">
              {{ formatModifier(mod.modifier) }}
            </div>
            <div class="whitespace-nowrap overflow-hidden text-ellipsis">{{ mod.label }}</div>
          </li>
        </ul>
      </template>
      <template #actionButtons>
        <button
          v-if="strikeModal.options?.type === 'strike'"
          type="button"
          class="bg-blue-600 hover:bg-blue-500 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-white focus:outline-none"
          @click="doStrike(`${strikeModal.itemId},${strikeModal.options.subtype}`)"
        >
          <span v-if="!strikeModal.options.subtype">Strike </span>
          <span>{{ viewedItem?.variants[strikeModal.options.subtype].label }}</span>
        </button>

        <button
          v-if="strikeModal.options?.type === 'damage' && strikeModal.options.subtype === 0"
          type="button"
          class="bg-red-600 hover:bg-red-500 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-white focus:outline-none"
          @click="doDamage(strikeModal.itemId, strikeModal.options.subtype)"
        >
          Damage
        </button>
        <button
          v-if="strikeModal.options?.type === 'damage' && strikeModal.options.subtype === 1"
          type="button"
          class="bg-red-600 hover:bg-red-500 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-white focus:outline-none"
          @click="doDamage(strikeModal.itemId, strikeModal.options.subtype)"
        >
          Critical
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
