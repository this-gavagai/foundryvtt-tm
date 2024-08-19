<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject, computed, watch, ref } from 'vue'
import { useCharacterSelect } from '@/composables/characterSelect'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import { getPath } from '@/utils/utilities'
import { Bars3Icon } from '@heroicons/vue/24/solid'
import { useKeys } from '@/composables/injectKeys'
import HitPoints from '@/components/HitPoints.vue'
import HeroPoints from '@/components/HeroPoints.vue'
import Spinner from '@/components/Spinner.vue'
import SideMenu from '@/components/SideMenu.vue'

const actor = inject(useKeys().actorKey)!
const { characterList, characterObjects } = useCharacterSelect()
const sideMenu = ref()
function reloadPage() {
  window.location.reload()
}
</script>

<template>
  <div class="flex cursor-pointer items-center gap-2 border-b p-4">
    <div class="hidden h-24 w-24 items-center 2xs:flex" @click="reloadPage">
      <img
        v-if="actor?.prototypeToken?.texture?.src"
        :src="getPath(actor.prototypeToken?.texture?.src)"
      />
      <div v-else class="min-h-24 h-full">
        <Spinner class="mr-2 h-full w-full p-4" />
      </div>
    </div>
    <div class="flex-1">
      <h3 class="mb-2 overflow-hidden whitespace-nowrap text-2xl">
        <Listbox>
          <ListboxButton>{{ actor?.name ?? 'Loading...' }}</ListboxButton>
          <ListboxOptions
            class="absolute mt-1 max-h-60 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 empty:hidden focus:outline-none sm:text-sm"
          >
            <ListboxOption v-if="!characterList"
              ><div class="relative select-none py-2 pl-6 pr-4 text-gray-400">
                Loading...
              </div></ListboxOption
            >
            <ListboxOption
              v-slot="{ active, selected }"
              v-for="character in characterList
                .filter((c: string) => c !== actor?._id)
                .map((c: string) => characterObjects.find((a: Actor) => a._id === c))"
              :key="character._id"
              :value="character"
              @click="$emit('pickCharacter', character._id)"
            >
              <div
                :class="[
                  active ? 'bg-blue-100 text-blue-900' : 'text-gray-900',
                  'relative cursor-pointer select-none py-2 pl-6 pr-4'
                ]"
              >
                {{ character?.name }}
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
      class="my-auto h-10 w-10 rounded-md border-gray-500 p-1 text-gray-500 md:hidden"
      @click="sideMenu.sidebarOpen = true"
    />
    <SideMenu ref="sideMenu" />
  </div>
</template>
