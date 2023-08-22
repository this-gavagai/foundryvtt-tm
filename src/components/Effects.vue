<script setup lang="ts">
import { useSheet } from '@/stores/sheet'
import { storeToRefs } from 'pinia'

const sheet = useSheet()
// const { actor, infoModal, foundryUrl } = storeToRefs(sheet)
</script>
<template>
  <!-- <div class="border border-t-0 px-6 py-4 flex gap-2">
    <div
      v-for="effect in actor.items.filter((i: Item) => ['effect', 'condition'].includes(i.type))"
      @click="console.log(effect)"
    >
      <div class="w-12">
        <div class="relative">
          <div
            v-if="effect.system?.value?.value"
            class="absolute right-0 bottom-0 bg-[#FFFFFFCC] border border-black px-1 text-xs"
          >
            {{ effect.system?.value?.value }}
          </div>
          <img :src="foundryUrl + effect.img" class="h-12 w-12 rounded-full" />
        </div>
        <div class="text-[0.5rem] whitespace-nowrap overflow-hidden w-12 text-center">
          {{ effect.name.replace('Effect: ', '') }}
        </div>
      </div>
    </div>
  </div> -->
</template>
