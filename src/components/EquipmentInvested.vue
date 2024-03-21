<script setup lang="ts">
// TODO: Refactor - switch over to API
import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject } from 'vue'
import { updateActorItem } from '@/composables/api'

const actor: Ref<Actor | undefined> = inject('actor')!

function toggleInvested(item: Item) {
  if (actor.value)
    updateActorItem(actor as Ref<Actor>, item._id, {
      system: {
        equipped: {
          invested: !item.system.equipped.invested
        }
      }
    })
}
</script>
<template>
  <ul>
    <li
      v-for="i in actor?.items.filter(
        (i: Item) => i.system?.equipped?.invested === true || i.system?.equipped?.invested === false
      )"
      :class="i.system?.equipped?.invested ? 'text-black' : 'text-gray-300'"
      class="cursor-pointer"
      @click="toggleInvested(i)"
    >
      <span>{{ i.system?.equipped?.invested ? '✓' : 'ｘ' }}</span>
      <span>{{ i.name }}</span>
    </li>
  </ul>
</template>
@/composables@/types/pf2e-types
