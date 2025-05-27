<script setup lang="ts">
import { inject } from 'vue'
import {} from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { immunities, weaknesses, resistances } = character
</script>
<template>
  <div class="flex justify-between px-6 py-4 empty:hidden">
    <section v-if="immunities?.length" class="w-1/3">
      <h3 class="underline">Immunity</h3>
      <ul>
        <li v-for="immunity in immunities" :key="immunity.type" class="text-sm capitalize">
          {{ immunity.type?.replace('-', ' ') }}
        </li>
      </ul>
    </section>
    <section v-if="weaknesses?.length" class="w-1/3">
      <h3 class="underline">Weakness</h3>
      <ul>
        <li v-for="weakness in weaknesses" :key="weakness.type" class="text-sm capitalize">
          {{ weakness.type?.replace('-', ' ') }} {{ weakness.value }}
        </li>
      </ul>
    </section>
    <section v-if="resistances?.length" class="w-1/3">
      <h3 class="underline">Resistance</h3>
      <ul>
        <li v-for="resistance in resistances" :key="resistance.type" class="text-sm capitalize">
          {{ resistance.type?.replace('-', ' ') }} {{ resistance.value }}
        </li>
      </ul>
    </section>
  </div>
</template>
