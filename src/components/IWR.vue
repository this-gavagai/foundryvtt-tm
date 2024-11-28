<script setup lang="ts">
import { inject } from 'vue'
import { capitalize } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { immunities, weaknesses, resistances } = character
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4 empty:hidden">
    <dl v-if="immunities?.length">
      <dt class="underline">Immunities</dt>
      <dd v-for="immunity in immunities" :key="immunity.type">
        {{ capitalize(immunity.type) }}
      </dd>
    </dl>
    <dl v-if="weaknesses?.length">
      <dt class="underline">Weaknesses</dt>
      <dd v-for="weakness in weaknesses" :key="weakness.type">
        {{ capitalize(weakness.type) }} {{ weakness.value }}
      </dd>
    </dl>
    <dl v-if="resistances?.length">
      <dt class="underline">Resistances</dt>
      <dd v-for="resistance in resistances" :key="resistance.type">
        {{ capitalize(resistance.type) }} {{ resistance.value }}
      </dd>
    </dl>
  </div>
</template>
