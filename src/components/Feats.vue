<script setup lang="ts">
import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, ref, computed, watch } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { featCategoryLabels } from '@/utils/constants'
import { useKeys } from '@/composables/injectKeys'

import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const actor = inject(useKeys().actorKey)!
const viewedItem = computed(() =>
  actor.value?.items?.find((i: Item) => i?._id === infoModal?.value?.itemId)
)

// watch(viewedItem, () => console.log(viewedItem))
</script>
<template>
  <div class="px-6 py-4 lg:columns-2">
    <dl v-if="actor?.feats" v-for="category in actor?.feats" class="break-inside-avoid-column">
      <dt class="pt-2 text-lg underline only:hidden">
        {{ featCategoryLabels.get(category.label) ?? category.label }}
      </dt>
      <dd v-for="feat in category.feats">
        <div class="relative">
          <a class="cursor-pointer" @click="infoModal.open(feat.feat._id)">
            <span class="absolute w-4 pt-1 text-right text-xs text-gray-500">{{
              feat?.level ?? feat.feat.system?.level?.value
            }}</span
            ><span class="pl-6">{{ feat.feat?.name }}</span>
          </a>
        </div>
        <div v-for="grant in feat.feat?.flags?.pf2e?.itemGrants" class="ml-10">
          <a class="cursor-pointer" @click="infoModal.open(grant.id)">
            {{ actor?.items.find((i: Item) => i._id == grant.id)?.name }}
          </a>
        </div>
      </dd>
    </dl>
    <div v-else>
      <ul>
        <!-- fallback for no actor details. some redundancy with above -->
        <li
          v-for="feat in actor?.items
            .filter((i: Item) => i.type === 'feat')
            .sort((a: Item, b: Item) => {
              return (
                (a.system.level.taken ?? a.system.level.value) -
                (b.system.level.taken ?? b.system.level.value)
              )
            })"
        >
          <div class="relative">
            <a class="cursor-pointer" @click="infoModal.open(feat._id)">
              <span class="absolute w-4 pt-1 text-right text-xs text-gray-500">{{
                feat.system?.level?.taken ?? feat.system?.level?.value
              }}</span
              ><span class="pl-6">{{ feat?.name }}</span>
            </a>
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
        <span v-if="viewedItem?.system?.level?.value" class="inline-block">
          Level {{ viewedItem?.system?.level?.value ?? '-' }}
        </span>
        <span v-if="viewedItem?.system?.traits?.rarity" class="inline-block">
          <span class="text-sm">({{ capitalize(viewedItem?.system.traits.rarity) }})</span>
        </span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/types/pf2e-types
