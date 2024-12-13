<script setup lang="ts">
import type { Actor } from '@/types/pf2e-types'
import { inject, ref } from 'vue'
import { useCharacterSelect } from '@/composables/characterSelect'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { getPath } from '@/utils/utilities'
import { Bars3Icon } from '@heroicons/vue/24/solid'
import { useKeys } from '@/composables/injectKeys'
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import Spinner from '@/components/SpinnerWidget.vue'
import SideMenu from '@/components/SideMenu.vue'
import { useWorld } from '@/composables/world'

const { world } = useWorld()

const character = inject(useKeys().characterKey)!
const { _id, name, portraitUrl } = character

const { characterList, setActiveCharacterId } = useCharacterSelect()
const sideMenu = ref()
function reloadPage() {
  window.location.reload()
}
</script>

<template>
  <div class="flex cursor-pointer items-center gap-2 border-y p-4">
    <div
      class="hidden h-24 w-24 items-center overflow-hidden rounded-full border-2 border-gray-300 bg-white xs:flex"
      @click="reloadPage"
    >
      <img
        v-if="portraitUrl"
        :src="getPath(portraitUrl)"
        class="scale-150"
        alt="Character portrait"
      />
      <div v-else class="h-full min-h-24">
        <Spinner class="mr-2 h-full w-full p-4" />
      </div>
    </div>
    <div class="min-w-44 flex-1">
      <h3 class="mb-2 w-full whitespace-nowrap text-2xl">
        <Listbox>
          <ListboxButton class="block w-full">
            <div class="w-full truncate text-left">{{ name ?? 'Loading...' }}</div>
          </ListboxButton>
          <ListboxOptions
            class="absolute mt-1 max-h-60 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 empty:hidden focus:outline-none sm:text-sm"
          >
            <ListboxOption v-if="!characterList">
              <div class="relative select-none py-2 pl-6 pr-4 text-gray-400">Loading...</div>
            </ListboxOption>
            <ListboxOption
              v-slot="{ active }"
              v-for="chr in characterList
                .filter((c) => c !== _id)
                .map((c: string) => world?.actors.find((a: Actor) => a._id === c))"
              :value="chr"
              @click="setActiveCharacterId(chr?._id)"
              :key="chr?._id"
            >
              <div
                v-if="chr?.name"
                :class="[
                  active ? 'bg-blue-100 text-blue-900' : 'text-gray-900',
                  'relative cursor-pointer select-none py-2 pl-6 pr-4'
                ]"
              >
                <div class="flex w-full gap-2">
                  <div class="pr-4">{{ chr?.name }}</div>
                </div>
              </div>
            </ListboxOption>
            <ListboxOption v-if="!world" key="loading">
              <div class="relative select-none py-2 pl-6 pr-4">
                <div class="flex w-full gap-2">
                  <Spinner class="w-4" />
                  <div class="animate-pulse pr-6">Loading...</div>
                </div>
              </div>
            </ListboxOption>
          </ListboxOptions>
        </Listbox>
      </h3>
      <div class="flex justify-start gap-8 align-middle">
        <HitPoints />
        <HeroPoints />
      </div>
    </div>
    <Bars3Icon
      class="my-auto h-10 w-10 cursor-pointer rounded-md border-gray-500 p-1 text-gray-500 active:text-gray-300 md:hidden"
      @click="sideMenu.sidebarOpen = true"
    />
    <SideMenu ref="sideMenu" />
  </div>
</template>
