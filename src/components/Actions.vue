<script setup lang="ts">
import type { Item } from '@/utils/pf2e-types'
const props = defineProps(['actor'])
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'

import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const actor: any = inject('actor')
const action = computed(
  () => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)
</script>

<template>
  <div class="px-6 py-4">
    <h3 class="underline text-2xl">Actions</h3>
    <ul>
      <li
        v-for="feat in actor.items.filter((i: Item) => i.system.actionType?.value === 'action')"
        class="cursor-pointer"
        @click="infoModal.open(null, feat._id)"
      >
        {{ feat.name }}
      </li>
    </ul>
    <h3 class="underline text-2xl pt-2">Reactions</h3>
    <ul>
      <li
        v-for="feat in actor.items.filter((i: Item) => i.system.actionType?.value === 'reaction')"
        class="cursor-pointer"
        @click="infoModal.open(null, feat._id)"
      >
        {{ feat.name }}
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal ref="infoModal" :imageUrl="action?.img" :traits="action?.system.traits.value">
      <template #title>
        {{ action?.name }}
      </template>
      <template #description>
        Level {{ action?.system.level?.value ?? 0 }}
        <span class="text-sm">({{ capitalize(action?.system?.traits?.rarity) }})</span>
      </template>
      <template #body>
        <div v-html="action?.system.description.value"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
