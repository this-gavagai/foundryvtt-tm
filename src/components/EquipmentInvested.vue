<script setup lang="ts">
import type { Equipment } from '@/composables/character'

import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { inventory } = character
</script>
<template>
  <ul data-component="EquipmentInvested">
    <li
      v-for="i in inventory?.filter(
        (i: Equipment) =>
          i.system?.equipped?.invested === true || i.system?.equipped?.invested === false
      )"
      :data-invested="i.system?.equipped?.invested ? 'true' : 'false'"
      :key="i._id"
    >
      <a class="cursor-pointer" @click="i?.toggleInvested?.()">
        <span>{{ i.system?.equipped?.invested ? '✓' : 'ｘ' }}</span>
        <span>{{ i.name }}</span>
      </a>
    </li>
  </ul>
</template>
