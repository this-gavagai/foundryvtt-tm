<script setup lang="ts">
// todo: filter for worn?
import { ref, inject, computed } from 'vue'
import { Listbox } from '@headlessui/vue'

import { capitalize, makeTraits, removeUUIDs } from '@/utils/utilities'
import ConsumablesType from './ConsumablesType.vue'

const infoModal: any = inject('infoModal')
const actor: any = inject('actor')

const consumables = computed(
  () =>
    actor?.items?.filter((x: any) => {
      return x.system.traits && x.system.traits.value.includes('consumable')
    }) || []
)
const infoConsumable = (id: string) => {
  const consumable = actor?.items.find((x: any) => x._id === id)
  console.log(consumable)
  infoModal.value?.open({
    title: consumable.name,
    description: `Level ${consumable.system.level.value} <span class="text-sm">(${capitalize(
      consumable.system.traits.rarity
    )}, ${consumable.system.price.value.gp}gp)</span>`,
    body:
      makeTraits(consumable.system.traits.value) + removeUUIDs(consumable.system.description.value),
    iconPath: consumable.img
  })
}
const sections = [
  { title: 'Bombs', trait: 'bomb' },
  { title: 'Elixirs', trait: 'elixir' },
  { title: 'Talismans', trait: 'talisman' }
]
// poison
</script>
<template>
  <div>
    <h3 class="underline text-2xl">Consumables</h3>
    <ConsumablesType
      v-for="s in sections"
      :title="s.title"
      :filter="(x: any) => x.system.traits.value.includes(s.trait)"
      :consumables="consumables"
      @consumableClicked="infoConsumable"
    />
    <ConsumablesType
      title="Others"
      :filter="
        (x: any) =>
          !x.system.traits.value.some((t: string) => sections.map((x) => x.trait).includes(t))
      "
      :consumables="consumables"
      @consumableClicked="infoConsumable"
    />
  </div>
</template>
