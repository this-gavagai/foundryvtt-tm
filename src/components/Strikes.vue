<script setup lang="ts">
// TODO: Handle unarmed strike (null strike on infomodal)
import type { Item } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { useServer } from '@/utils/server'
import { capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'

const infoModal: any = inject('infoModal')
const actor: any = inject('actor')

const { socket } = useServer()

function infoStrike(strike: any) {
  if (!strike) return
  infoModal.value?.open({
    title: strike?.label ?? strike?.item?.name,
    description: /*HTML*/ `
      <span class="border p-1 mr-2 text-xs">
        <span class="pf2-icon text-lg pr-1">1</span>Strike ${strike.variants[0].label}
      </span>
      <span class="border p-1 mr-2 text-xs">${strike.variants[1].label}</span>
      <span class="border p-1 mr-2 text-xs">${strike.variants[2].label}</span>
    `,
    traits: strike?.weaponTraits.map((t: any) => t.label),
    body: /*HTML*/ `
      <div>
        HI
      </div>
    `,
    iconPath: strike?.imageUrl ?? strike?.item?.img
  })
}
function makeStrike(slug: string, variant: number) {
  socket.value.emit('module.tablemate', {
    action: 'makeStrike',
    characterId: actor.value._id,
    strikeSlug: slug,
    strikeVariant: variant
  })
}
</script>
<template>
  <div class="px-6">
    <h3 class="underline text-2xl py-2">Strikes</h3>
    <ul>
      <li
        v-for="strike in actor.system?.actions
          ?.filter((a: any) => a.type === 'strike')
          .map((a: any) => {
            a['item'] = actor.items.find((i: Item) => i.system?.slug === a?.slug)
            return a
          })
          .filter(
            (a: any) => a.item?.system?.equipped?.carryType === 'held' || a.item === undefined
          )"
        class="cursor-pointer text-xl pb-2"
        @click="infoStrike(strike)"
      >
        <!-- <div class="text-xs border p-1 w-8 mr-1 text-right">
          {{ SignedNumber.format(strike?.totalModifier) }}
        </div> -->
        <div>{{ strike?.item?.name ?? strike?.label }}</div>
        <div>
          <!-- <span
            v-for="(variant, index) in strike.variants"
            class="bg-blue-300 border border-blue-800 p-1 mr-2 text-xs"
            @click="makeStrike(strike.slug, index)"
          > -->
          <span v-for="(variant, index) in strike.variants" class="border p-1 mr-2 text-xs">
            <span v-if="!index" class="pf2-icon text-lg pr-1">1</span>
            <span v-if="!index">Strike </span>
            <span>{{ variant.label }}</span>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
