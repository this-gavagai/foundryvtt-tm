<script setup lang="ts">
// TODO: provide better interface when falling back on world data by providing a computed variable that approximates the default sorting?
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, ref, computed, watch } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { featCategoryLabels } from '@/utils/constants'

import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const actor: Actor | undefined = inject('actor')
const viewedItem = computed(
  () => actor?.value.items?.find((i: Item) => i?._id === infoModal?.value?.itemId)
)

// watch(viewedItem, () => console.log(viewedItem))
</script>
<template>
  <div class="px-6 py-4">
    <dl v-if="actor?.feats" v-for="category in actor?.feats">
      <dt class="underline text-lg only:hidden pt-2">
        {{ featCategoryLabels.get(category.label) ?? category.label }}
      </dt>
      <dd v-for="feat in category.feats">
        <div class="relative" @click="infoModal.open(feat.feat._id)">
          <span class="text-xs text-gray-500 absolute text-right w-4 pt-1">{{
            feat?.level ?? feat.feat.system?.level?.value
          }}</span
          ><span class="pl-6 cursor-pointer">{{ feat.feat?.name }}</span>
        </div>
        <div
          v-for="grant in feat.feat?.flags?.pf2e?.itemGrants"
          class="ml-10 cursor-pointer"
          @click="infoModal.open(grant.id)"
        >
          {{ actor?.items.find((i: Item) => i._id == grant.id)?.name }}
        </div>
      </dd>
    </dl>
    <div v-else>
      <ul>
        <!-- fallback for no actor details. some redundancy with above -->
        <li
          v-for="feat in actor?.items
            .filter((i: Item) => i.type === 'feat')
            .sort((a: any, b: any) => {
              return (
                (a.system.level.taken ?? a.system.level.value) -
                (b.system.level.taken ?? b.system.level.value)
              )
            })"
        >
          <div class="relative" @click="infoModal.open(feat._id)">
            <span class="text-xs text-gray-500 absolute text-right w-4 pt-1">{{
              feat.system?.level?.taken ?? feat.system?.level?.value
            }}</span
            ><span class="pl-6 cursor-pointer">{{ feat?.name }}</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedItem?.img"
      :traits="viewedItem?.system.traits.value"
    >
      <template #title>
        {{ viewedItem?.name }}
      </template>
      <template #description>
        Level {{ viewedItem?.system?.level?.value ?? '-' }}
        <span class="text-sm">({{ capitalize(viewedItem?.system.traits.rarity) }})</span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/types/pf2e-types
