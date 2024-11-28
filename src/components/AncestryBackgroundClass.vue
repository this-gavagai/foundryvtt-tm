<script setup lang="ts">
import type { Ref } from 'vue'
import type { Item } from '@/types/pf2e-types'
import type { Character } from '@/composables/character'
import { inject, computed, ref } from 'vue'
import { capitalize, removeUUIDs } from '@/utils/utilities'
import InfoModal from '@/components/InfoModal.vue'
import { useKeys } from '@/composables/injectKeys'

const infoModal = ref()
const character = inject(useKeys().characterKey) as Character
const { ancestry, heritage, background, classType, level } = character

const viewedItem: Ref<Item | undefined> = computed(() => {
  return [ancestry.value, heritage.value, background.value, classType.value].find(
    (i: Item | undefined) => {
      return i?._id === infoModal.value?.itemId
    }
  )
})
</script>
<template>
  <div class="my-auto shrink">
    <div class="cursor-pointer overflow-hidden whitespace-nowrap text-sm">
      <span @click="infoModal.open(ancestry?._id)">{{ ancestry?.name ?? '-' }}&nbsp;</span>
      <span @click="infoModal.open(background?._id)">{{ background?.name }}</span>
    </div>
    <div
      class="cursor-pointer overflow-hidden whitespace-nowrap text-sm"
      @click="infoModal.open(classType?._id)"
    >
      <span>{{ classType?.name ?? '-' }}</span>
      <span v-if="level">{{ ` (Level ${level})` }}</span>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedItem?.img"
      :traits="viewedItem?.system?.traits.value"
    >
      <template #title>
        {{ viewedItem?.name }}
      </template>
      <template #description>
        Level {{ viewedItem?.system?.level?.value ?? '-' }}
        <span class="text-sm">({{ capitalize(viewedItem?.system?.traits.rarity) }})</span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system?.description.value)"></div>
        <div v-if="viewedItem?.type === 'ancestry'">
          <hr />
          <div class="mt-2">
            <h3 class="text-lg">{{ heritage?.name }}</h3>
            <div v-html="removeUUIDs(heritage?.system?.description.value)"></div>
          </div>
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
