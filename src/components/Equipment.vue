<script setup lang="ts">
// TODO: figure out how the parenthetical worn style works (system.usage.value: 'worngloves', etc.)
// TODO: some kind of feedback on the carry toggle on click
// TODO: add unarmed strike here? or in actions?

import EquipmentInvested from '@/components/EquipmentInvested.vue'

import type { Item, FeatCategory, Actor } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { makeTraits, capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

const { socket } = useServer()
const props = defineProps<{ actor: Actor }>()
const infoModal: any = inject('infoModal')
const actor: any = inject('actor')

function updateCarry(item: Item, systemUpdate: {}) {
  console.log(actor)
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
          system: systemUpdate
        }
      ]
    },
    (x: any) => {
      console.log(x)
      x.result.forEach((change: any) => {
        let inventoryItem = actor.value.items.find((a: any) => a._id == change._id)
        mergeDeep(inventoryItem, change)
      })
    }
  )
}

function infoEquip(item: Item) {
  console.log(item)
  infoModal.value?.open({
    title: item.name,
    description: `Level ${item.system.level.value} <span class="text-sm">(${capitalize(
      item.system.traits.rarity
    )}, ${printPrice(item.system.price.value)})</span>`,
    body: makeTraits(item.system.traits.value) + removeUUIDs(item.system.description.value),
    iconPath: item.img,
    toggleSet: [
      {
        toggleText: '1-Hand',
        toggleTrigger: () =>
          updateCarry(item, {
            containerId: null,
            equipped: {
              carryType: 'held',
              handsHeld: 1
            }
          }),
        toggleIsActive: () =>
          item.system.equipped.carryType === 'held' && item.system.equipped.handsHeld === 1
      },
      {
        toggleText: '2-Hands',
        toggleTrigger: () =>
          updateCarry(item, {
            containerId: null,
            equipped: {
              carryType: 'held',
              handsHeld: 2
            }
          }),
        toggleIsActive: () =>
          item.system.equipped.carryType === 'held' && item.system.equipped.handsHeld === 2
      },
      {
        toggleText: 'Worn',
        toggleTrigger: () =>
          updateCarry(item, {
            containerId: null,
            equipped: {
              carryType: 'worn',
              handsHeld: 0
            }
          }),
        toggleIsActive: () => item.system.equipped.carryType === 'worn'
      },
      {
        toggleText: 'Stowed',
        toggleTrigger: () =>
          updateCarry(item, {
            containerId: actor.items.find((i: any) => i.type === 'backpack')?._id,
            equipped: {
              carryType: 'stowed',
              handsHeld: 0
            }
          }),
        toggleIsActive: () => item.system.equipped.carryType === 'stowed'
      },
      {
        toggleText: 'Dropped',
        toggleTrigger: () =>
          updateCarry(item, {
            containerId: null,
            equipped: {
              carryType: 'dropped',
              handsHeld: 0
            }
          }),
        toggleIsActive: () => item.system.equipped.carryType === 'dropped'
      }
    ]
  })
}

function infoInvested() {
  const invested = actor.value.items
    .filter(
      (i: Item) => i.system?.equipped?.invested === true || i.system?.equipped?.invested === false
    )
    .map((i: Item) => `<li class="cursor-pointer">${i.name}</li>`)
  console.log(invested.join(''))
  infoModal.value.open({
    title: 'Invested Items',
    component: EquipmentInvested,
    componentProps: { actor: actor }
  })
}

const inventoryTypes = [
  { type: 'weapon', title: 'Weapons' },
  { type: 'consumable', title: 'Consumables' },
  { type: 'equipment', title: 'Equipment' },
  { type: 'armor', title: 'Armor' },
  { type: 'treasure', title: 'Treasure' },
  { type: 'backpack', title: 'Containers' }
]
</script>
<template>
  <div class="px-6 py-4">
    <h3 class="text-2xl">
      <span class="underline">Equipment</span>
      <span class="cursor-pointer text-sm text-gray-500" @click="infoInvested()">
        ({{ actor.items.filter((i: Item) => i.system?.equipped?.invested).length }}/10 Invested)
      </span>
    </h3>

    <ul>
      <li
        v-for="item in actor.items.filter((i: Item) => i.system?.equipped?.handsHeld > 0)"
        @click="infoEquip(item)"
        class="cursor-pointer text-2xl whitespace-nowrap"
      >
        <span class="pr-1">{{
          item.system?.equipped?.handsHeld > 0
            ? item.system?.equipped?.handsHeld === 1
              ? '❶'
              : '❷'
            : item.system?.equipped?.carryType === 'dropped'
            ? '⌵'
            : 'Ⓦ'
        }}</span>
        <span>{{ item.name }}</span>
      </li>
    </ul>
    <dl v-for="inventoryType in inventoryTypes" class="pt-4 whitespace-nowrap">
      <dt class="underline text-lg only:hidden">{{ inventoryType.title }}</dt>
      <dd
        v-for="item in actor.items.filter(
          (i: Item) => i.type === inventoryType.type && !i.system?.containerId
        )"
        class="cursor-pointer"
      >
        <div
          :class="{
            'text-gray-300': item.system?.equipped?.carryType === 'dropped'
          }"
          @click="infoEquip(item)"
        >
          <span>{{ item.name }}</span>
          <span class="text-xs"> x{{ item.system.quantity }}</span>
        </div>
        <ul class="ml-4" v-if="item.type === 'backpack'">
          <li
            v-for="stowed in actor.items.filter((i: Item) => i.system?.containerId === item._id)"
            @click="infoEquip(stowed)"
          >
            {{ stowed.name }}<span class="text-xs"> x{{ stowed.system.quantity }}</span>
          </li>
        </ul>
      </dd>
    </dl>
  </div>
</template>
