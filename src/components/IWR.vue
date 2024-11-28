<script setup lang="ts">
import { inject } from 'vue'
import { capitalize } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

const actor = inject(useKeys().actorKey)!
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4 empty:hidden">
    <dl v-if="actor?.system?.attributes.immunities?.length">
      <dt class="underline">Immunities</dt>
      <dd v-for="immunity in actor?.system?.attributes.immunities" :key="immunity.type">
        {{ capitalize(immunity.type) }}
      </dd>
    </dl>
    <dl v-if="actor?.system?.attributes.weaknesses?.length">
      <dt class="underline">Weaknesses</dt>
      <dd v-for="weakness in actor?.system?.attributes.weaknesses" :key="weakness.type">
        {{ capitalize(weakness.type) }} {{ weakness.value }}
      </dd>
    </dl>
    <dl v-if="actor?.system?.attributes.resistances?.length">
      <dt class="underline">Resistances</dt>
      <dd v-for="resistance in actor?.system?.attributes.resistances" :key="resistance.type">
        {{ capitalize(resistance.type) }} {{ resistance.value }}
      </dd>
    </dl>
  </div>
</template>
@/types/pf2e-types
