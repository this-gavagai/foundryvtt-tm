<script setup lang="ts">
import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
import { inject } from 'vue'
import Statistic from './Statistic.vue'
import { SignedNumber, formatModifier } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { attributes } from '@/utils/constants'
import { useKeys } from '@/composables/injectKeys'
import { capitalize } from '@/utils/utilities'

const actor = inject(useKeys().actorKey)!
</script>
<template>
  <div class="px-6 py-4 flex justify-between border-b">
    <ul>
      <li
        class="inline [&:not(:last-child)]:after:content-[',_']"
        v-for="lang in actor?.system.details.languages.value.slice().reverse()"
      >
        {{ capitalize(lang) }}
      </li>
    </ul>
  </div>
</template>
