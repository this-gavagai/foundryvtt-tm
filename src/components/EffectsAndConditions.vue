<script setup lang="ts">
// TODO (refactor):Change to ButtonWidget
// TODO (UX): add latency feedback to buttons
import type { Item } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import InfoModal from '@/components/InfoModal.vue'
import { useKeys } from '@/composables/injectKeys'

import { removeUUIDs, getPath } from '@/utils/utilities'

const character = inject(useKeys().characterKey)!
const { effects } = character

const infoModal = ref()
const viewedItem = computed(() =>
  effects.value?.find((i: Item) => i._id === infoModal?.value?.itemId)
)
</script>
<template>
  <div class="flex flex-wrap gap-2 border border-t-0 px-6 py-4 empty:hidden">
    <div
      class="cursor-pointer"
      v-for="effect in effects"
      :key="effect._id"
      @click="infoModal.open(effect._id)"
    >
      <div class="w-10">
        <div class="relative">
          <div
            v-if="effect.system?.value?.isValued"
            class="absolute bottom-0 right-0 border border-black bg-[#FFFFFFCC] px-1 text-xs"
          >
            {{ effect.system?.value?.value }}
          </div>
          <img :src="getPath(effect.img ?? '')" class="rounded-full" />
        </div>
        <div class="overflow-hidden whitespace-nowrap text-center text-[0.5rem]">
          {{ effect?.name?.replace('Effect: ', '') }}
        </div>
      </div>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal ref="infoModal" :imageUrl="viewedItem?.img">
      <template #title>
        {{ viewedItem?.name }}
        {{ viewedItem?.system?.value?.value }}
      </template>
      <template #description>
        <span class="capitalize">{{ viewedItem?.type }}</span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system?.description?.value)"></div>
      </template>
      <template #actionButtons>
        <button
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-red-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-red-300 focus:outline-none"
          @click="
            () => {
              if (viewedItem?.delete) viewedItem.delete()
              infoModal.close()
            }
          "
        >
          Remove
        </button>
        <button
          type="button"
          v-if="viewedItem?.system?.value?.isValued"
          class="inline-flex items-end justify-center border border-transparent bg-gray-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-300 focus:outline-none"
          @click="() => viewedItem?.changeQty?.((viewedItem?.system?.value?.value ?? NaN) - 1)"
        >
          -
        </button>
        <button
          type="button"
          v-if="viewedItem?.system?.value?.isValued"
          class="inline-flex items-end justify-center border border-transparent bg-gray-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-300 focus:outline-none"
          @click="() => viewedItem?.changeQty?.((viewedItem?.system?.value?.value ?? NaN) + 1)"
        >
          +
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
