<script setup lang="ts">
// TODO: Handle unarmed strike (null strike on infomodal)
import type { Item } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { makeTraits, capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'

const { actor } = defineProps(['actor'])
const infoModal: any = inject('infoModal')

function infoStrike(strike: any) {
  console.log('Strike: ', strike)
  if (!strike) return
  infoModal.value?.open({
    title: strike.name,
    description: `Level ${strike.system.level.value} <span class="text-sm">(${capitalize(
      strike.system.traits.rarity
    )}, ${printPrice(strike.system.price.value)})</span>`,
    body: makeTraits(strike.system.traits.value) + removeUUIDs(strike.system.description.value),
    iconPath: strike.img
  })
}
const strikeCategories = [
  {
    title: 'Basic',
    catFilter: (i: Item) => i === undefined
  },
  {
    title: 'Held',
    catFilter: (i: Item) => i?.system?.equipped?.carryType === 'held'
  },
  {
    title: 'Dropped',
    catFilter: (i: Item) => i?.system?.equipped?.carryType === 'dropped'
  },
  {
    title: 'Worn',
    catFilter: (i: Item) => i?.system?.equipped?.carryType === 'worn'
  },
  {
    title: 'Stowed',
    catFilter: (i: Item) => i?.system?.equipped?.carryType === 'stowed'
  }
]
</script>
<template>
  <div class="px-6">
    <h3 class="underline text-2xl py-2">New Strikes</h3>
    <dl v-for="category in strikeCategories" class="pb-2 last:pb-0">
      <dt class="underline text-lg only:hidden">{{ category.title }}</dt>
      <dd
        v-for="strike in actor.system.actions
          .filter((a: any) => a.type === 'strike')
          .map((a: any) => {
            a['item'] = actor.items.find((i: Item) => i.system.slug === a?.slug)
            return a
          })
          .filter((a: any) => category.catFilter(a.item))"
        @click="infoStrike(strike.item)"
        class="m-1"
      >
        <span class="text-xs border p-1">{{ SignedNumber.format(strike.totalModifier) }} </span
        >{{ strike?.item?.name ?? strike?.label }}
        <!-- <span class="text-xs border p-1">{{
          new Intl.NumberFormat('en-US', {
            signDisplay: 'exceptZero'
          }).format(
            actor.system.actions.find((a: any) => a.slug === strike.system.slug)?.totalModifier
          )
        }}</span>
        {{ strike.name }} -->
      </dd>
    </dl>
    <!-- <h3 class="underline text-2xl py-2">Strikes</h3>
    <dl v-for="category in strikeCategories" class="pb-2 last:pb-0">
      <dt class="underline text-lg only:hidden">{{ category.title }}</dt>
      <dd
        v-for="strike in actor.items.filter(
          (i: Item) => i.type === 'weapon' && category.catFilter(i)
        )"
        @click="infoStrike(strike)"
        class="m-1"
      >
        <span class="text-xs border p-1">{{
          new Intl.NumberFormat('en-US', {
            signDisplay: 'exceptZero'
          }).format(
            actor.system.actions.find((a: any) => a.slug === strike.system.slug)?.totalModifier
          )
        }}</span>
        {{ strike.name }}
      </dd>
    </dl> -->
  </div>
</template>
