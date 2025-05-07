<script setup lang="ts">
import { inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'

const character = inject(useKeys().characterKey)!
const { languages } = character
</script>
<template>
  <div class="px-6 py-4 [&:not(:has(li))]:hidden">
    <div v-if="languages?.length === 0" class="italic">No languages known</div>
    <div v-else class="underline">Languages</div>
    <ul class="min-h-6">
      <li
        class="inline text-sm capitalize not-last:after:content-[',_']"
        v-for="lang in languages?.slice().reverse()"
        :key="'lang_' + lang"
      >
        {{ lang }}
      </li>
    </ul>
  </div>
</template>
