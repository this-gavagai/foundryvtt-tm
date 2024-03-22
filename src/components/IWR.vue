<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject } from 'vue'
import { capitalize } from '@/utils/utilities'
import { useInjectKeys } from '@/composables/injectKeys'

const actor: Ref<Actor | undefined> = inject('actor')!
</script>
<template>
  <div class="px-6 py-4 flex justify-between border-b empty:hidden">
    <dl v-if="actor?.system?.attributes.immunities?.length">
      <dt class="underline">Immunities</dt>
      <dd v-for="immunity in actor?.system?.attributes.immunities">
        {{ capitalize(immunity.type) }}
      </dd>
    </dl>
    <dl v-if="actor?.system?.attributes.weaknesses?.length">
      <dt class="underline">Weaknesses</dt>
      <dd v-for="weakness in actor?.system?.attributes.weaknesses">
        {{ capitalize(weakness.type) }} {{ weakness.value }}
      </dd>
    </dl>
    <dl v-if="actor?.system?.attributes.resistances?.length">
      <dt class="underline">Resistances</dt>
      <dd v-for="resistance in actor?.system?.attributes.resistances">
        {{ capitalize(resistance.type) }} {{ resistance.value }}
      </dd>
    </dl>
  </div>
</template>
@/types/pf2e-types
