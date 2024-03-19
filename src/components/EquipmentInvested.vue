<script setup lang="ts">
import type { Ref } from 'vue'
import type { Item, Actor } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { useServer } from '@/composables/server'
import { mergeDeep } from '@/utils/utilities'

const props = defineProps(['actor'])
const actor: Ref<Actor | undefined> = inject('actor')!

const { socket } = useServer()

function toggleInvested(item: Item) {
  if (!actor.value) return
  socket.value.emit(
    'modifyDocument',
    {
      action: 'update',
      type: 'Item',
      parentUuid: 'Actor.' + actor.value._id,
      options: { diff: true, render: true },
      updates: [
        {
          _id: item._id,
          system: {
            equipped: {
              invested: !item.system.equipped.invested
            }
          }
        }
      ]
    },
    (x: any) => {
      console.log(x)
      x.result.forEach((change: any) => {
        let inventoryItem = actor.value?.items.find((a: any) => a._id == change._id)
        mergeDeep(inventoryItem, change)
      })
    }
  )
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
@/composables/server
