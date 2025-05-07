<script setup lang="ts">
import { inject } from 'vue'
import {} from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { immunities, weaknesses, resistances } = character
</script>
<template>
  <div class="flex justify-between px-6 py-4 empty:hidden">
    <dl v-if="immunities?.length" class="w-1/3">
      <dt class="underline">Immunity</dt>
      <dd v-for="immunity in immunities" :key="immunity.type" class="text-sm capitalize">
        {{ immunity.type?.replace('-', ' ') }}
      </dd>
    </dl>
    <dl v-if="weaknesses?.length" class="w-1/3">
      <dt class="underline">Weakness</dt>
      <dd v-for="weakness in weaknesses" :key="weakness.type" class="text-sm capitalize">
        {{ weakness.type?.replace('-', ' ') }} {{ weakness.value }}
      </dd>
    </dl>
    <dl v-if="resistances?.length" class="w-1/3">
      <dt class="underline">Resistance</dt>
      <dd v-for="resistance in resistances" :key="resistance.type" class="text-sm capitalize">
        {{ resistance.type?.replace('-', ' ') }} {{ resistance.value }}
      </dd>
    </dl>
  </div>
</template>
