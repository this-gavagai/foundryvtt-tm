<script setup lang="ts">
import { inject, ref } from 'vue'
import type { Item } from '@/utils/pf2e-types'
import InfoModal from '@/components/InfoModal.vue'

import { capitalize, removeUUIDs, getPath } from '@/utils/utilities'

// const infoModal: any = inject('infoModal')
const infoModal = ref()
const actor: any = inject('actor')
// const props = defineProps(['actor'])

function infoCondition(effect: any) {
  console.log(effect)
  infoModal.value.open({
    title: `${effect.name} ${effect.system?.value?.value ?? ''}`,
    description: `${capitalize(effect.type)}`,
    body: removeUUIDs(effect.system.description.value),
    iconPath: effect.img
  })
}
</script>
<template>
  <div class="border border-t-0 px-6 py-4 flex gap-2 empty:hidden">
    <div
      v-for="effect in actor?.items?.filter((i: Item) => ['effect', 'condition'].includes(i.type))"
      @click="infoCondition(effect)"
    >
      <div class="w-12">
        <div class="relative">
          <div
            v-if="effect.system?.value?.value"
            class="absolute right-0 bottom-0 bg-[#FFFFFFCC] border border-black px-1 text-xs"
          >
            {{ effect.system?.value?.value }}
          </div>
          <img :src="getPath(effect.img)" class="h-12 w-12 rounded-full" />
        </div>
        <div class="text-[0.5rem] whitespace-nowrap overflow-hidden w-12 text-center">
          {{ effect.name.replace('Effect: ', '') }}
        </div>
      </div>
    </div>
  </div>
  <Teleport to="#modals">
    <InfoModal ref="infoModal" />
  </Teleport>
</template>
