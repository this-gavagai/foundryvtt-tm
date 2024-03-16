<script setup lang="ts">
// TODO: (ux) some kind of feedback on the carry toggle on click

// TODO: (bug) figure out how the parenthetical worn style works (system.usage.value: 'worngloves', etc.)
// TODO: (bug) stowed items sometimes show up as "worn" in the togglebar. Why?
// TODO: (refactor) switch over to API

// TODO: (feature) Move between multiple backpacks?
// TODO: (feature) add ability to change quantity of items
// TODO: (feature) add ability to remove items
// TODO: (feature) add ability to add new items

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import Modal from '@/components/Modal.vue'
import InfoModal from '@/components/InfoModal.vue'

import type { Item, FeatCategory, Actor } from '@/utils/pf2e-types'
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

const { socket } = useServer()
const actor: any = inject('actor')
const infoModal = ref()
const investedModal = ref()
const item = computed(() => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId))

function updateCarry(item: Item, systemUpdate: {}) {
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

function infoInvested() {
  const invested = actor.value.items
    .filter(
      (i: Item) => i.system?.equipped?.invested === true || i.system?.equipped?.invested === false
    )
    .map((i: Item) => `<li class="cursor-pointer">${i.name}</li>`)
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
  { type: 'backpack', title: '' }
]

const toggleSet = [
  {
    toggleText: '1-Hand',
    toggleTrigger: () =>
      updateCarry(item.value, {
        containerId: null,
        equipped: {
          carryType: 'held',
          handsHeld: 1
        }
      }),
    toggleIsActive: () =>
      item.value?.system.equipped.carryType === 'held' &&
      item.value?.system.equipped.handsHeld === 1
  },
  {
    toggleText: '2-Hands',
    toggleTrigger: () =>
      updateCarry(item.value, {
        containerId: null,
        equipped: {
          carryType: 'held',
          handsHeld: 2
        }
      }),
    toggleIsActive: () =>
      item.value?.system.equipped.carryType === 'held' &&
      item.value?.system.equipped.handsHeld === 2
  },
  {
    toggleText: 'Worn',
    toggleTrigger: () =>
      updateCarry(item.value, {
        containerId: null,
        equipped: {
          carryType: 'worn',
          handsHeld: 0
        }
      }),
    toggleIsActive: () => item.value?.system.equipped.carryType === 'worn'
  },
  {
    toggleText: 'Stowed',
    toggleTrigger: () => {
      console.log(actor)
      updateCarry(item.value, {
        containerId: actor.value.items.find((i: any) => i.type === 'backpack')?._id,
        equipped: {
          carryType: 'stowed',
          handsHeld: 0
        }
      })
    },
    toggleIsActive: () => item.value?.system.equipped.carryType === 'stowed'
  },
  {
    toggleText: 'Dropped',
    toggleTrigger: () =>
      updateCarry(item.value, {
        containerId: null,
        equipped: {
          carryType: 'dropped',
          handsHeld: 0
        }
      }),
    toggleIsActive: () => item.value?.system.equipped.carryType === 'dropped'
  }
]
</script>
<template>
  <div class="px-6 py-4">
    <ul>
      <li
        v-for="item in actor.items.filter((i: Item) => i.system?.equipped?.handsHeld > 0)"
        @click="infoModal.open(item._id)"
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
    <div>
      <span class="cursor-pointer text-sm text-gray-500" @click="investedModal.open()">
        ({{ actor.items.filter((i: Item) => i.system?.equipped?.invested).length }}/10 Invested)
      </span>
    </div>
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
            'text-gray-300': item.system?.equipped?.carryType === 'dropped',
            'underline text-lg': item.type === 'backpack'
          }"
          @click="infoModal.open(item._id)"
        >
          <span>{{ item.name }}</span>
          <span v-if="item.type !== 'backpack'" class="text-xs"> x{{ item.system.quantity }}</span>
        </div>
        <ul class="pb-2" v-if="item.type === 'backpack'">
          <li
            v-for="stowed in actor.items.filter((i: Item) => i.system?.containerId === item._id)"
            @click="infoModal.open(stowed._id)"
          >
            {{ stowed.name }}<span class="text-xs"> x{{ stowed.system.quantity }}</span>
          </li>
        </ul>
      </dd>
    </dl>
  </div>
  <Teleport to="#modals">
    <Modal ref="investedModal" title="Invested Items">
      <EquipmentInvested :actor="actor" />
    </Modal>
    <InfoModal ref="infoModal" :imageUrl="item?.img" :traits="item?.system.traits.value">
      <template #title>
        {{ item?.name }}
      </template>
      <template #description>
        Level {{ item?.system.level.value }}
        <span class="text-sm">
          ({{ capitalize(item?.system.traits.rarity) }}), {{ printPrice(item?.system.price.value) }}
        </span>
      </template>
      <template #beforeBody>
        <div
          class="flex my-2 basis-full justify-items-center empty:hidden border border-gray-400 cursor-pointer rounded-md w-full text-xs mb-2"
        >
          <div
            v-for="t in toggleSet"
            class="p-2 flex-auto border-l border-gray-300 first:border-none text-center"
            @click="t?.toggleTrigger()"
            :class="{ 'bg-gray-300': t.toggleIsActive() }"
          >
            {{ t.toggleText }}
          </div>
        </div>
      </template>
      <template #body>
        <div v-html="removeUUIDs(item?.system.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
