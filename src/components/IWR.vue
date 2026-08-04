<script setup lang="ts">
import { useInjectedActor } from '@/composables/injectKeys'

// Optional on the shared actor surface: absent on actors that don't track IWR,
// in which case every section's `?.length` guard hides the whole block.
const { immunities, weaknesses, resistances } = useInjectedActor()
</script>
<template>
  <div data-component="IWR" class="flex grow justify-between empty:hidden">
    <section v-if="immunities?.length">
      <h3 class="text-[0.8rem] font-normal uppercase">{{ $t('iwr.immunity') }}</h3>
      <ul>
        <li v-for="immunity in immunities" :key="immunity.type" class="text-sm capitalize">
          {{ immunity.label }}
        </li>
      </ul>
    </section>
    <section v-if="weaknesses?.length">
      <h3 class="text-[0.8rem] font-normal uppercase">{{ $t('iwr.weakness') }}</h3>
      <ul>
        <li v-for="weakness in weaknesses" :key="weakness.type" class="text-sm capitalize">
          {{ weakness.label }}
        </li>
      </ul>
    </section>
    <section v-if="resistances?.length">
      <h3 class="text-[0.8rem] font-normal uppercase">{{ $t('iwr.resistance') }}</h3>
      <ul>
        <li v-for="resistance in resistances" :key="resistance.type" class="text-sm capitalize">
          {{ resistance.label }}
        </li>
      </ul>
    </section>
  </div>
</template>
