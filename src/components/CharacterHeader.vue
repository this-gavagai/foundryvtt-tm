<script setup lang="ts">
// TODO: Implement hamburger menu popout, with settings and meta-options like "Rest"
import type { Ref } from 'vue'
import type { Actor } from '@/utils/pf2e-types'
import { inject, computed, watch, ref } from 'vue'
import {
  Listbox,
  ListboxLabel,
  ListboxButton,
  ListboxOptions,
  ListboxOption
} from '@headlessui/vue'
import { getPath } from '@/utils/utilities'
import { Bars3Icon } from '@heroicons/vue/24/solid'
import HitPoints from './HitPoints.vue'
import HeroPoints from './HeroPoints.vue'

const world: any = inject('world')
const actor: Ref<Actor | undefined> = inject('actor')!
const changeChar: any = inject('changeChar')
</script>

<template>
  <div class="flex gap-2 border p-4 items-center">
    <div class="h-24 w-24">
      <img
        v-if="actor?.prototypeToken?.texture?.src"
        :src="getPath(actor.prototypeToken?.texture?.src)"
        class="h-24 w-24"
      />
      <div v-else class="h-full min-h-24">
        <svg
          aria-hidden="true"
          class="w-full h-full mr-2 p-4 text-gray-200 animate-spin dark:text-gray-100 fill-gray-400"
          viewBox="0 0 100 101"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
            fill="currentColor"
          />
          <path
            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
            fill="currentFill"
          />
        </svg>
      </div>
    </div>
    <div class="flex-1">
      <h3 class="text-2xl whitespace-nowrap overflow-hidden mb-2">
        <Listbox>
          <ListboxButton>{{ actor?.name ?? 'Loading...' }}</ListboxButton>
          <ListboxOptions
            class="absolute mt-1 empty:hidden max-h-60 w-6/12 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
          >
            <ListboxOption v-if="!world.actors"
              ><div class="text-gray-400 relative select-none py-2 pl-6 pr-4">
                Loading...
              </div></ListboxOption
            >
            <ListboxOption
              v-slot="{ active, selected }"
              v-for="character in world.actors
                ?.filter((a: any) => a.ownership[world.userId] === 3)
                ?.filter((a: any) => a._id !== actor?._id)"
              :key="character?._id"
              :value="character"
              :disabled="character?.unavailable"
              @click="changeChar(character._id)"
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
      <!-- <AncestryBackgroundClass /> -->
      <div class="flex gap-8 align-middle">
        <HitPoints />
        <HeroPoints />
      </div>
    </div>
    <Bars3Icon class="h-10 w-10 my-auto text-gray-600 border-2 border-gray-600 rounded-md p-1" />
  </div>
</template>
