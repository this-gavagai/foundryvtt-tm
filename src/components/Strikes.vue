<script setup lang="ts">
// TODO: Handle unarmed strike (null strike on infomodal)
import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, ref, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useApi } from '@/composables/api'

import InfoModal from './InfoModal.vue'
const strikeModal = ref()
const actor: Ref<Actor> = inject('actor')!
const { rollCheck } = useApi()
const viewedItem = computed(() => actor.value?.system?.actions?.[strikeModal.value?.itemId])

function doStrike(slug: string) {
  rollCheck(actor, 'strike', slug)
}
</script>
<template>
  <div class="px-6">
    <h3 class="underline text-2xl py-2">Strikes</h3>
    <ul>
      <li
        v-for="(strike, i) in actor?.system?.actions
          ?.filter((a: any) => a.type === 'strike')
          .map((a: any) => {
            a['item'] = actor.items?.find((i: Item) => i.system?.slug === a?.slug)
            return a
          })
          .filter(
            (a: any) => a.item?.system?.equipped?.carryType === 'held' || a.item === undefined
          )"
        class="cursor-pointer text-xl pb-2"
        @click="strikeModal.open(i, {})"
      >
        <!-- <div class="text-xs border p-1 w-8 mr-1 text-right">
          {{ SignedNumber.format(strike?.totalModifier) }}
        </div> -->
        <div>{{ strike?.item?.name ?? strike?.label }}</div>
        <div>
          <!-- <span
            v-for="(variant, index) in strike.variants"
            class="bg-blue-300 border border-blue-800 p-1 mr-2 text-xs"
            @click="makeStrike(strike.slug, index)"
          > -->
          <span v-for="(variant, index) in strike.variants" class="border p-1 mr-2 text-xs">
            <span v-if="!index" class="pf2-icon text-lg pr-1">1</span>
            <span v-if="!index">Strike </span>
            <span>{{ variant.label }}</span>
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
          .map((t: any) => t.label)
          .concat(viewedItem?.weaponTraits.map((t: any) => t.label))
      "
      :imageUrl="viewedItem?.item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp'"
    >
      <template #title>{{ viewedItem?.label }}</template>
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
          v-for="(variant, i) in viewedItem?.variants"
          type="button"
          class="bg-blue-600 hover:bg-blue-500 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-white focus:outline-none"
          @click="doStrike(`${strikeModal.itemId},${i}`)"
        >
          Strike {{ variant.label.match(/[+-][0-9]*/g)[0] }}
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/composables/api@/composables@/types/pf2e-types
