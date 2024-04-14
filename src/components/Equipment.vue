<script setup lang="ts">
// TODO: (feature) add sub-menu for "inSlot" and multiple backpacks
// TODO: (feature) add ability to add new items
// TODO: (feature) add weight, encumbrance, etc.
// TODO: (UX) feedback mechanism on toggle bar

import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { inventoryTypes } from '@/utils/constants'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import Modal from '@/components/Modal.vue'
import InfoModal from '@/components/InfoModal.vue'

const actor = inject(useKeys().actorKey)!
const infoModal = ref()
const investedModal = ref()
const item = computed(
  () => actor.value?.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)
const { updateActorItem, deleteActorItem } = useApi()

function updateCarry(item: Item | undefined, systemUpdate: {}) {
  if (!item) return
  if (actor.value) updateActorItem(actor as Ref<Actor>, item._id, systemUpdate)
}

function deleteItem(itemId: string) {
  if (actor.value && itemId) deleteActorItem(actor as Ref<Actor>, itemId)
}
function incrementItemQty(itemId: string, change: number) {
  console.log(itemId)
  if (!actor.value || !itemId) return
  const item = actor.value?.items.find((i: any) => i._id === itemId)
  const newValue = item?.system?.quantity + change
  const update = { system: { quantity: newValue } }
  if (actor.value)
    updateActorItem(actor as Ref<Actor>, itemId, update, { conditionValue: newValue })
}

const toggleSet = [
  {
    toggleText: '1-Hand',
    toggleTrigger: () =>
      updateCarry(item.value, {
        system: {
          containerId: null,
          equipped: {
            carryType: 'held',
            handsHeld: 1
          }
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
        system: {
          containerId: null,
          equipped: {
            carryType: 'held',
            handsHeld: 2
          }
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
        system: {
          containerId: null,
          equipped: {
            carryType: 'worn',
            handsHeld: 0,
            inSlot: true
          }
        }
      }),
    toggleIsActive: () => item.value?.system.equipped.carryType === 'worn'
  },
  {
    toggleText: 'Stowed',
    toggleTrigger: () => {
      updateCarry(item.value, {
        system: {
          containerId: actor.value?.items.find((i: any) => i.type === 'backpack')?._id,
          equipped: {
            carryType: 'stowed',
            handsHeld: 0
          }
        }
      })
    },
    toggleIsActive: () => item.value?.system.equipped.carryType === 'stowed'
  },
  {
    toggleText: 'Dropped',
    toggleTrigger: () =>
      updateCarry(item.value, {
        system: {
          containerId: null,
          equipped: {
            carryType: 'dropped',
            handsHeld: 0
          }
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
        v-for="item in actor?.items.filter((i: Item) => i.system?.equipped?.handsHeld > 0)"
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
        ({{ actor?.items.filter((i: Item) => i.system?.equipped?.invested).length }}/10 Invested)
      </span>
    </div>
    <div class="lg:columns-2">
      <dl
        v-for="inventoryType in inventoryTypes"
        class="pt-4 whitespace-nowrap break-inside-avoid-column"
      >
        <dt class="underline text-lg only:hidden">{{ inventoryType.title }}</dt>
        <dd
          v-for="item in actor?.items.filter(
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
            <span v-if="item.type !== 'backpack'" class="text-xs">
              (x{{ item.system.quantity }})</span
            >
          </div>
          <ul class="pb-2" v-if="item.type === 'backpack'">
            <li
              v-for="stowed in actor?.items.filter((i: Item) => i.system?.containerId === item._id)"
              @click="infoModal.open(stowed._id)"
            >
              {{ stowed.name }}<span class="text-xs"> (x{{ stowed.system.quantity }})</span>
            </li>
          </ul>
        </dd>
      </dl>
    </div>
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
      <template #actionButtons v-if="item">
        <div class="flex-1">Qty: {{ item?.system.quantity }}</div>
        <button
          type="button"
          class="bg-red-200 hover:bg-red-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="
            () => {
              deleteItem(item!._id)
              infoModal.close()
            }
          "
        >
          Remove
        </button>
        <button
          type="button"
          class="bg-gray-200 hover:bg-gray-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="() => incrementItemQty(item!._id, -1)"
        >
          -
        </button>
        <button
          type="button"
          class="bg-gray-200 hover:bg-gray-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="() => incrementItemQty(item!._id, 1)"
        >
          +
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/composables@/types/pf2e-types
