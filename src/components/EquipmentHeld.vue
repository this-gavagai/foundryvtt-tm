<script setup lang="ts">
import { inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import type { Equipment } from '@/composables/character'

const character = inject(useKeys().characterKey)!
const { inventory } = character
const emits = defineEmits(['itemClicked'])
</script>
<template>
  <ul class="peer mb-4 flex flex-col justify-start transition-all duration-1000">
    <TransitionGroup
      enter-active-class="transform duration-200 ease-out"
      enter-from-class=" opacity-0 max-h-0 scale-0"
      enter-to-class="opacity-100 max-h-7 scale-100"
      leave-active-class="transform duration-200 ease-in"
      leave-from-class="opacity-100 max-h-7 scale-100"
      leave-to-class="opacity-0 max-h-0 scale-0"
    >
      <li
        v-for="item in inventory?.filter((i: Equipment) => i.system?.equipped?.handsHeld)"
        class="relative origin-left text-xl whitespace-nowrap transition-all duration-300"
        :class="item.name ? 'max-h-7' : 'max-h-0'"
        :key="item._id"
      >
        <a
          class="cursor-pointer"
          @click="
            emits('itemClicked', item)
            // () => {
            //   itemViewedId = item._id
            //   infoModal.open()
            // }
          "
        >
          <Transition
            enter-active-class="transform duration-100 delay-200 ease-out"
            :enter-from-class="
              item.system?.equipped?.handsHeld === 1 ? 'opacity-0 -top-4' : 'opacity-0 top-4'
            "
            enter-to-class="opacity-100 top-0"
            leave-active-class="transform duration-300 ease-in"
            leave-from-class="opacity-100 top-0"
            :leave-to-class="
              item.system?.equipped?.handsHeld === 1 ? 'opacity-0 top-4' : 'opacity-0 -top-4'
            "
          >
            <span v-if="item.system?.equipped?.handsHeld === 1" class="absolute origin-center pr-1"
              >❶</span
            >
            <span v-else class="absolute origin-center pr-1">❷</span>
          </Transition>
          <span class="ml-6">{{ item.name }}</span>
        </a>
      </li>
    </TransitionGroup>
  </ul>
</template>
