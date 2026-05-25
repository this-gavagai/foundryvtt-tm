<script setup lang="ts">
import { Bars3Icon } from '@heroicons/vue/24/solid'
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import CharacterPortrait from '@/components/CharacterPortrait.vue'
import CharacterSelector from '@/components/CharacterSelector.vue'

function reloadPage() {
  window.location.reload()
}
const emit = defineEmits(['sidebarActivated'])
</script>

<template>
  <div class="border-divider flex cursor-pointer items-center gap-2 border-y p-4">
    <CharacterPortrait @click="reloadPage" />
    <div class="min-w-36 flex-1">
      <CharacterSelector />
      <div class="flex justify-start gap-8 align-middle">
        <HitPoints />
        <HeroPoints />
      </div>
    </div>
    <Bars3Icon
      class="border-divider my-auto h-10 w-10 cursor-pointer rounded-md p-1 text-gray-500 active:text-gray-300 md:hidden"
      @click="() => emit('sidebarActivated')"
    />
  </div>
</template>
