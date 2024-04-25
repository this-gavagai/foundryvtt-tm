<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor, Item } from '@/types/pf2e-types'
import { inject, computed, watch, ref } from 'vue'
import { capitalize, removeUUIDs } from '@/utils/utilities'
import InfoModal from '@/components/InfoModal.vue'
import { useKeys } from '@/composables/injectKeys'

const infoModal = ref()

const actor = inject(useKeys().actorKey)!

const ancestry = computed(() => actor.value?.items?.find((x: Item) => x.type === 'ancestry'))
const heritage = computed(() => actor.value?.items?.find((x: Item) => x.type === 'heritage'))
const background = computed(() => actor.value?.items?.find((x: Item) => x.type === 'background'))
const gameclass = computed(() => actor.value?.items?.find((x: Item) => x.type === 'class'))
const viewedItem: Ref<Item | undefined> = computed(
  () => actor.value?.items?.find((i: Item) => i._id === infoModal?.value?.itemId)
)
</script>
<template>
  <div class="my-auto shrink">
    <div class="cursor-pointer overflow-hidden whitespace-nowrap text-sm">
      <span @click="infoModal.open(ancestry?._id)">{{ ancestry?.name ?? '-' }}&nbsp;</span>
      <span @click="infoModal.open(background?._id)">{{ background?.name }}</span>
    </div>
    <div
      class="cursor-pointer overflow-hidden whitespace-nowrap text-sm"
      @click="infoModal.open(gameclass?._id)"
    >
      <span>{{ gameclass?.name ?? '-' }}</span>
      <span v-if="actor?.system?.details.level.value">{{
        ` (Level ${actor?.system?.details.level.value})`
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
        <div v-if="viewedItem?.type === 'ancestry'">
          <hr />
          <div class="mt-2">
            <h3 class="text-lg">{{ heritage?.name }}</h3>
            <div v-html="removeUUIDs(heritage?.system.description.value)"></div>
          </div>
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
