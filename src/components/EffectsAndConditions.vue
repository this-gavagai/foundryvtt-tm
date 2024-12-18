<script setup lang="ts">
import { inject, ref, computed } from 'vue'
import InfoModal from '@/components/InfoModal.vue'
import { useKeys } from '@/composables/injectKeys'
import Button from '@/components/ButtonWidget.vue'
import { removeUUIDs, getPath } from '@/utils/utilities'

const character = inject(useKeys().characterKey)!
const { effects } = character
const infoModal = ref()
const effectViewedId = ref<string | undefined>()
const effectViewed = computed(() => effects.value?.find((e) => e._id === effectViewedId.value))
</script>
<template>
  <div
    class="relative flex flex-wrap gap-2 overflow-hidden border border-t-0 px-6 transition-all duration-300"
    :class="[
      effects?.length && effects?.length > 0
        ? 'h-[5.25rem] scale-y-100 border-opacity-100 py-4'
        : 'h-0 scale-y-0 border-opacity-0 py-0'
    ]"
  >
    <div
      class="h-10 cursor-pointer"
      v-for="effect in effects"
      :key="effect._id"
      @click="
        () => {
          effectViewedId = effect._id
          infoModal.open()
        }
      "
    >
      <div class="w-10">
        <div class="relative">
          <div
            v-if="effect.system?.value?.isValued"
            class="absolute bottom-0 right-0 border border-black bg-[#FFFFFFCC] px-1 text-xs"
          >
            {{ effect.system?.value?.value }}
          </div>
          <img :src="getPath(effect.img ?? '')" class="rounded-full" alt="Effect icon" />
        </div>
        <div class="overflow-hidden whitespace-nowrap text-center text-[0.5rem]">
          {{ effect?.name?.replace('Effect: ', '') }}
        </div>
      </div>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :itemId="effectViewed?._id"
      :imageUrl="effectViewed?.img"
      :traits="[]"
    >
      <template #title>
        {{ effectViewed?.name }}
        {{ effectViewed?.system?.value?.value }}
      </template>
      <template #description>
        <span class="capitalize">{{ effectViewed?.type }}</span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(effectViewed?.system?.description?.value)"></div>
      </template>
      <template #actionButtons>
        <Button
          color="red"
          :clicked="
            () => {
              infoModal.close()
              if (effectViewed?.delete) return effectViewed?.delete()
            }
          "
        >
          Remove
        </Button>
        <Button
          v-if="effectViewed?.system?.value?.isValued"
          color="lightgray"
          :clicked="
            () => effectViewed?.changeQty?.((effectViewed?.system?.value?.value ?? NaN) - 1)
          "
        >
          -
        </Button>
        <Button
          v-if="effectViewed?.system?.value?.isValued"
          color="lightgray"
          :clicked="
            () => effectViewed?.changeQty?.((effectViewed?.system?.value?.value ?? NaN) + 1)
          "
        >
          +
        </Button>
      </template>
    </InfoModal>
  </Teleport>
</template>
