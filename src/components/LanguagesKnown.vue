<script setup lang="ts">
import { inject } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { capitalize } from '@/utils/utilities'

const character = inject(useKeys().characterKey)!
const { languages } = character
</script>
<template>
  <div class="flex justify-between border-b px-6 py-4">
    <ul>
      <li
        class="inline [&:not(:last-child)]:after:content-[',_']"
        v-for="lang in languages?.slice().reverse()"
        :key="'lang_' + lang"
      >
        {{ capitalize(lang) }}
      </li>
    </ul>
  </div>
</template>
