<script setup lang="ts">
import type { Equipment } from '@/composables/character'

import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { inventory } = character
</script>
<template>
  <ul>
    <li
      v-for="i in inventory?.filter(
        (i: Equipment) =>
          i.system?.equipped?.invested === true || i.system?.equipped?.invested === false
      )"
      :class="i.system?.equipped?.invested ? 'text-black' : 'text-gray-300'"
      :key="i._id"
    >
      <a class="cursor-pointer" @click="i?.toggleInvested?.()">
        <span>{{ i.system?.equipped?.invested ? '✓' : 'ｘ' }}</span>
        <span>{{ i.name }}</span>
      </a>
    </li>
  </ul>
</template>
