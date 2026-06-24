<script setup lang="ts">
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue'
import Spinner from '@/components/widgets/SpinnerWidget.vue'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useCharacterSelectStore } from '@/stores/characterSelect'
import { useWorldStore } from '@/stores/world'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import { storeToRefs } from 'pinia'

const { world } = storeToRefs(useWorldStore())
const { _id, name } = useInjectedCharacter()
const characterSelectStore = useCharacterSelectStore()
const { characterList } = storeToRefs(characterSelectStore)
const { setActiveCharacterId } = characterSelectStore
</script>
<template>
  <h3 class="mb-2 w-full text-2xl whitespace-nowrap">
    <Listbox>
      <ListboxButton class="block w-full" @pointerdown="triggerLightHapticFeedback()">
        <div class="w-full cursor-pointer truncate text-left">
          {{ name ?? $t('common.loading') }}
        </div>
      </ListboxButton>
      <ListboxOptions
        data-part="dropdown-options"
        class="absolute z-50 mt-1 max-h-60 overflow-auto rounded-md border border-gray-200 bg-white py-1 text-base text-gray-900 shadow-lg empty:hidden focus:outline-hidden sm:text-sm"
      >
        <ListboxOption v-if="!characterList">
          <div class="relative py-2 pr-4 pl-6 select-none opacity-60">
            {{ $t('common.loading') }}
          </div>
        </ListboxOption>
        <ListboxOption
          v-for="chr in characterList
            .filter((c) => c !== _id)
            .map((c: string) => world?.actors.find((a: ActorPF2e) => a._id === c))"
          :value="chr"
          @pointerdown="triggerLightHapticFeedback()"
          @click="setActiveCharacterId(chr?._id ?? undefined)"
          :key="chr?._id ?? undefined"
        >
          <div
            v-if="chr?.name"
            class="relative cursor-pointer py-2 pr-4 pl-6 select-none"
          >
            <div class="flex w-full gap-2">
              <div class="pr-4">{{ chr?.name }}</div>
            </div>
          </div>
        </ListboxOption>
        <ListboxOption v-if="!world" key="loading">
          <div class="relative py-2 pr-4 pl-6 select-none">
            <div class="flex w-full gap-2">
              <Spinner class="w-4" />
              <div class="animate-pulse pr-6">{{ $t('common.loading') }}</div>
            </div>
          </div>
        </ListboxOption>
      </ListboxOptions>
    </Listbox>
  </h3>
</template>
