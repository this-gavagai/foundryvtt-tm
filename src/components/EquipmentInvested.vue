<script setup lang="ts">
import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject } from 'vue'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

const actor = inject(useKeys().actorKey)!
const { updateActorItem } = useApi()

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
      :key="i._id"
    >
      <a class="cursor-pointer" @click="toggleInvested(i)">
        <span>{{ i.system?.equipped?.invested ? '✓' : 'ｘ' }}</span>
        <span>{{ i.name }}</span>
      </a>
    </li>
  </ul>
</template>
