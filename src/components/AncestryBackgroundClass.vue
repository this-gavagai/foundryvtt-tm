<script setup lang="ts">
import { inject, computed, watch, ref } from 'vue'
import { capitalize, removeUUIDs } from '@/utils/utilities'
import InfoModal from '@/components/InfoModal.vue'
const infoModal = ref()

const actor: any = inject('actor')!
const ancestry = computed(() => actor.value.items?.find((x: any) => x.type === 'ancestry'))
const heritage = computed(() => actor.value.items?.find((x: any) => x.type === 'heritage'))
const background = computed(() => actor.value.items?.find((x: any) => x.type === 'background'))
const gameclass = computed(() => actor.value.items?.find((x: any) => x.type === 'class'))
const viewedItem: any = computed(
  () => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)
</script>
<template>
  <div>
    <div class="text-md whitespace-nowrap overflow-hidden cursor-pointer">
      <span @click="infoModal.open(ancestry._id)">{{ ancestry?.name ?? '-' }}&nbsp;</span>
      <span @click="infoModal.open(background._id)">{{ background?.name }}</span>
    </div>
    <div
      class="text-md whitespace-nowrap overflow-hidden cursor-pointer"
      @click="infoModal.open(gameclass._id)"
    >
      <span>{{ gameclass?.name ?? '-' }}</span>
      <span v-if="actor.system?.details.level.value">{{
        ` (Level ${actor.system?.details.level.value})`
      }}</span>
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
        <hr />
        <div v-if="viewedItem?.type === 'ancestry'" class="mt-2">
          <h3 class="text-lg">{{ heritage.name }}</h3>
          <div v-html="heritage.system.description.value"></div>
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
