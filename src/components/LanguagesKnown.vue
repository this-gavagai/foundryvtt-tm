<script setup lang="ts">

import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { languages } = character
</script>
<template>
  <div data-component="LanguagesKnown" class="[&:not(:has(li))]:hidden">
    <div v-if="languages?.length === 0" class="italic">{{ $t('languages.none') }}</div>
    <div v-else data-part="heading" class="text-[0.8rem] font-normal uppercase">
      {{ $t('languages.heading') }}
    </div>
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
