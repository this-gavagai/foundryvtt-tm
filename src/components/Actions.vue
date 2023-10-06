<script setup lang="ts">
import type { Item } from '@/utils/pf2e-types'
const props = defineProps(['actor'])
import { inject } from 'vue'
import { makeTraits, capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'

const infoModal: any = inject('infoModal')
const actor: any = inject('actor')

function infoAction(action: any) {
  console.log('Action: ', action)
  if (!action) return
  infoModal.value?.open({
    title: action?.name,
    description: `Level ${action?.system.level?.value ?? 0} <span class="text-sm">(${capitalize(
      action?.system?.traits?.rarity
    )})</span>`,
    body:
      (makeTraits(action?.system.traits.value) ?? '') +
      (removeUUIDs(action?.system.description.value) ?? ''),
    iconPath: action?.img
  })
}
</script>

<template>
  <div class="px-6 py-4">
    <h3 class="underline text-2xl">Actions</h3>
    <ul>
      <li
        v-for="feat in actor.items.filter((i: Item) => i.system.actionType?.value === 'action')"
        class="cursor-pointer"
        @click="infoAction(feat)"
      >
        {{ feat.name }}
      </li>
    </ul>
    <h3 class="underline text-2xl pt-2">Reactions</h3>
    <ul>
      <li
        v-for="feat in actor.items.filter((i: Item) => i.system.actionType?.value === 'reaction')"
        class="cursor-pointer"
        @click="infoAction(feat)"
      >
        {{ feat.name }}
      </li>
    </ul>
  </div>
</template>
