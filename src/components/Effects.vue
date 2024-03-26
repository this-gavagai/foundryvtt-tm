<script setup lang="ts">
// TODO: (feature) add ability to add new effects
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject, ref, computed } from 'vue'
import type { Item } from '@/types/pf2e-types'
import InfoModal from '@/components/InfoModal.vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import { capitalize, removeUUIDs, getPath } from '@/utils/utilities'

const infoModal = ref()
const actor = inject(useKeys().actorKey)!
const viewedItem = computed(
  () => actor.value?.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)

const { deleteActorItem, updateActorItem } = useApi()
function deleteEffect(effectId: string | undefined) {
  if (actor.value && effectId) deleteActorItem(actor as Ref<Actor>, effectId)
}
function incrementEffectValue(effectId: string | undefined, change: number) {
  if (!actor.value || !effectId) return
  const effect = actor.value?.items.find((i: any) => i._id === effectId)
  const newValue = effect?.system?.value.value + change
  const update = { system: { value: { value: newValue } } }
  if (actor.value)
    updateActorItem(actor as Ref<Actor>, effectId, update, { conditionValue: newValue })
}
</script>
<template>
  <div class="border border-t-0 px-6 py-4 flex gap-2 empty:hidden flex-wrap">
    <div
      class="cursor-pointer"
      v-for="effect in actor?.items?.filter((i: Item) => ['effect', 'condition'].includes(i?.type))"
      @click="infoModal.open(effect._id)"
    >
      <div class="w-10">
        <div class="relative">
          <div
            v-if="effect.system?.value?.isValued"
            class="absolute right-0 bottom-0 bg-[#FFFFFFCC] border border-black px-1 text-xs"
          >
            {{ effect.system?.value?.value }}
          </div>
          <img :src="getPath(effect.img)" class="rounded-full" />
        </div>
        <div class="text-[0.5rem] whitespace-nowrap overflow-hidden text-center">
          {{ effect.name.replace('Effect: ', '') }}
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
        {{ capitalize(viewedItem?.type) }}
      </template>
      <template #body>
        <div v-html="removeUUIDs(viewedItem?.system?.description?.value)"></div>
      </template>
      <template #actionButtons>
        <button
          type="button"
          class="bg-red-200 hover:bg-red-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="
            () => {
              deleteEffect(viewedItem?._id)
              infoModal.close()
            }
          "
        >
          Remove
        </button>
        <button
          type="button"
          v-if="viewedItem?.system?.value?.isValued"
          class="bg-gray-200 hover:bg-gray-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="() => incrementEffectValue(viewedItem?._id, -1)"
        >
          -
        </button>
        <button
          type="button"
          v-if="viewedItem?.system?.value?.isValued"
          class="bg-gray-200 hover:bg-gray-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="() => incrementEffectValue(viewedItem?._id, 1)"
        >
          +
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/composables/api @/composables@/types/pf2e-types@/types/pf2e-types
