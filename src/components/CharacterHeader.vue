<script setup lang="ts">
// TODO: (feature+) Implement hamburger menu popout, with settings and meta-options like "Rest"
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

const world: any = inject(useKeys().worldKey)
const actor = inject(useKeys().actorKey)!
const { characterList } = useCharacterSelect()
function reloadPage() {
  window.location.reload()
}
</script>

<template>
  <div class="flex gap-2 border-b p-4 items-center cursor-pointer">
    <div class="h-24 w-24 items-center hidden 2xs:flex" @click="reloadPage">
      <img
        v-if="actor?.prototypeToken?.texture?.src"
        :src="getPath(actor.prototypeToken?.texture?.src)"
      />
      <div v-else class="h-full min-h-24">
        <Spinner class="w-full h-full mr-2 p-4" />
      </div>
    </div>
    <div class="flex-1">
      <h3 class="text-2xl whitespace-nowrap overflow-hidden mb-2">
        <Listbox>
          <ListboxButton>{{ actor?.name ?? 'Loading...' }}</ListboxButton>
          <ListboxOptions
            class="absolute mt-1 empty:hidden max-h-60 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
          >
            <ListboxOption v-if="!world?.actors"
              ><div class="text-gray-400 relative select-none py-2 pl-6 pr-4">
                Loading...
              </div></ListboxOption
            >
            <ListboxOption
              v-slot="{ active, selected }"
              v-for="character in characterList
                .filter((c: string) => c !== actor?._id)
                .map((c: string) => world.actors.find((a: Actor) => a._id === c))"
              :key="character._id"
              :value="character"
              @click="$emit('pickCharacter', character._id)"
            >
              <div
                :class="[
                  active ? 'bg-blue-100 text-blue-900' : 'text-gray-900',
                  'relative select-none py-2 pl-6 pr-4 cursor-pointer'
                ]"
              >
                {{ character?.name }}
              </div>
            </ListboxOption>
          </ListboxOptions>
        </Listbox>
      </h3>
      <div class="flex gap-8 align-middle justify-start">
        <HitPoints />
        <HeroPoints />
      </div>
    </div>
    <Bars3Icon class="md:hidden h-10 w-10 my-auto text-gray-500 border-gray-500 rounded-md p-1" />
  </div>
</template>
@/composables/characterSelect @/types/pf2e-types
