<script setup lang="ts">
import type { Item } from '@/composables/character'
import type { Character } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import { removeUUIDs } from '@/utils/utilities'
import InfoModal from '@/components/InfoModal.vue'
import { useKeys } from '@/composables/injectKeys'

const infoModal = ref()
const character = inject(useKeys().characterKey) as Character
const { ancestry, heritage, background, classType, level } = character
const identityViewedId = ref<string | undefined>()
const identityViewed = computed(
  () =>
    [ancestry, heritage, background, classType].find((i) => i.value?._id === identityViewedId.value)
      ?.value
)
function viewItem(item: Item | undefined) {
  identityViewedId.value = item?._id
  if (item) infoModal.value.open()
}
</script>
<template>
  <div class="my-auto shrink">
    <div class="cursor-pointer overflow-hidden whitespace-nowrap text-sm">
      <span @click="viewItem(ancestry)">{{ ancestry?.name ?? '-' }}&nbsp;</span>
      <span @click="viewItem(background)">{{ background?.name }}</span>
    </div>
    <div
      class="cursor-pointer overflow-hidden whitespace-nowrap text-sm"
      @click="viewItem(classType)"
    >
      <span>{{ classType?.name ?? '-' }}</span>
      <span v-if="level && classType?.name">{{ ` (Level ${level})` }}</span>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="identityViewed?.img"
      :itemId="identityViewed?._id"
      :traits="identityViewed?.system?.traits?.value"
    >
      <template #title>
        {{ identityViewed?.name }}
      </template>
      <template #description>
        <span v-if="identityViewed?.system?.level?.value"
          >Level {{ identityViewed?.system?.level?.value ?? '-' }}</span
        >
        <span v-if="identityViewed?.system?.traits?.rarity" class="text-sm capitalize"
          >({{ identityViewed?.system?.traits?.rarity }})</span
        >
      </template>
      <template #body>
        <div v-html="removeUUIDs(identityViewed?.system?.description?.value)"></div>
        <div v-if="identityViewed?.type === 'ancestry'">
          <hr />
          <div class="mt-2">
            <h3 class="text-lg">{{ heritage?.name }}</h3>
            <div v-html="removeUUIDs(heritage?.system?.description?.value)"></div>
          </div>
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
