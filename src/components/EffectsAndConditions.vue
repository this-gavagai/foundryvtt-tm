<script setup lang="ts">
import type { Item } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import InfoModal from '@/components/InfoModal.vue'
import { useKeys } from '@/composables/injectKeys'
import Button from '@/components/ButtonWidget.vue'

import { removeUUIDs, getPath } from '@/utils/utilities'

const character = inject(useKeys().characterKey)!
const { effects } = character

const plusButtonRef = ref()
const minusButtonRef = ref()
const removeButtonRef = ref()

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
        <Button
          ref="removeButtonRef"
          color="red"
          :clicked="
            () => {
              infoModal.close()
              if (viewedItem?.delete) return viewedItem.delete()
            }
          "
        >
          Remove
        </Button>
        <Button
          ref="minusButtonRef"
          v-if="viewedItem?.system?.value?.isValued"
          color="lightgray"
          :clicked="
            () => {
              return viewedItem?.changeQty?.((viewedItem?.system?.value?.value ?? NaN) - 1)
            }
          "
        >
          -
        </Button>
        <Button
          ref="plusButtonRef"
          v-if="viewedItem?.system?.value?.isValued"
          color="lightgray"
          @click="
            () => {
              viewedItem?.changeQty?.((viewedItem?.system?.value?.value ?? NaN) + 1)
            }
          "
        >
          +
        </Button>
      </template>
    </InfoModal>
  </Teleport>
</template>
