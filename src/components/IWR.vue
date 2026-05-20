<script setup lang="ts">

import {} from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { immunities, weaknesses, resistances } = character
</script>
<template>
  <div class="flex justify-between px-6 py-4 empty:hidden">
    <section v-if="immunities?.length" class="w-1/3">
      <h3 class="underline">{{ $t('iwr.immunity') }}</h3>
      <ul>
        <li v-for="immunity in immunities" :key="immunity.type" class="text-sm capitalize">
          {{ immunity.type?.replace('-', ' ') }}
        </li>
      </ul>
    </section>
    <section v-if="weaknesses?.length" class="w-1/3">
      <h3 class="underline">{{ $t('iwr.weakness') }}</h3>
      <ul>
        <li v-for="weakness in weaknesses" :key="weakness.type" class="text-sm capitalize">
          {{ weakness.type?.replace('-', ' ') }} {{ weakness.value }}
        </li>
      </ul>
    </section>
    <section v-if="resistances?.length" class="w-1/3">
      <h3 class="underline">{{ $t('iwr.resistance') }}</h3>
      <ul>
        <li v-for="resistance in resistances" :key="resistance.type" class="text-sm capitalize">
          {{ resistance.type?.replace('-', ' ') }} {{ resistance.value }}
        </li>
      </ul>
    </section>
  </div>
</template>
