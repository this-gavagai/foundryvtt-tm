<script setup lang="ts">
// TODO: (feature) add weight, encumbrance, etc.
// TODO: (refactor) switch toggle bar over to headlessui component and give transaction feedback
// TODO: (refactor) refactor listbox into component, and give transaction feedback
// TODO: (refactor) refactor Switch into component, and give transactionf eedback
// TODO: (UX) ListboxOptions max-h and max-w properties are a mess

import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, ref, computed, watch } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { inventoryTypes } from '@/utils/constants'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Switch } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/20/solid'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import Modal from '@/components/Modal.vue'
import InfoModal from '@/components/InfoModal.vue'
import { useGamepad } from '@vueuse/core'

const actor = inject(useKeys().actorKey)!
const infoModal = ref()
const investedModal = ref()
const { updateActor, updateActorItem, deleteActorItem } = useApi()

const item = computed(
  () => actor.value?.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)
const itemWornType = computed(() => {
  if (item.value?.type === 'armor') return 'Armor'
  const usage = item.value?.system.usage?.value
  if (usage.slice(0, 4) === 'worn' && usage.slice(4)) {
    return capitalize(usage.slice(4))
  }
})

watch(item, (newValue) => {
  itemLocation.value = newValue?.system.containerId
  itemWorn.value = newValue?.system.equipped.inSlot
  itemInvested.value = newValue?.system.equipped.invested
})

const itemLocation = ref(item.value?.system.containerId)
watch(itemLocation, (newValue) => {
  if (item.value)
    updateActorItem(actor as Ref<Actor>, item.value._id, { system: { containerId: newValue } })
})
const itemWorn = ref(item.value?.system.equipped.inSlot)
watch(itemWorn, (newValue) => {
  if (item.value)
    updateActorItem(actor as Ref<Actor>, item.value._id, {
      system: { equipped: { inSlot: newValue } }
    })
})
const itemInvested = ref(item.value?.system.equipped.invested)
watch(itemInvested, (newValue) => {
  if (item.value)
    updateActorItem(actor as Ref<Actor>, item.value._id, {
      system: { equipped: { invested: newValue } }
    })
})

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
            handsHeld: 0
            // inSlot: true // trying to understand "inSlot". Not totally clear to me how it works
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
        (Invested: {{ actor?.items.filter((i: Item) => i.system?.equipped?.invested).length }} / 10)
      </span>
    </div>
    <div class="lg:columns-2">
      <dl
        v-for="inventoryType in inventoryTypes"
        class="pt-4 whitespace-nowrap break-inside-avoid-column break-before-avoid"
        :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
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
        <div class="my-2">
          <div
            class="flex border-gray-400 basis-full justify-items-center empty:hidden border cursor-pointer rounded-md w-full text-xs mb-2"
          >
            <div
              v-for="t in toggleSet"
              class="p-2 flex-auto border-l border-gray-300 first:border-none text-center"
              @click="t?.toggleTrigger()"
              :class="{ 'bg-gray-300': t.toggleIsActive() }"
            >
              <span>{{ t.toggleText }}</span>
              <!-- <span v-if="t.toggleText === 'Worn' && itemWornType">
                ({{ item?.system.equipped.inSlot ? itemWornType : 'x' }})</span
              > -->
            </div>
          </div>
          <div v-if="item?.system.equipped.carryType === 'worn' && itemWornType" class="flex">
            <Switch
              v-model="itemWorn"
              :class="itemWorn ? 'bg-green-600' : 'bg-gray-500'"
              class="relative inline-flex h-[18px] w-[34px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
            >
              <span class="sr-only">Item Worn in Slot?</span>
              <span
                aria-hidden="true"
                :class="itemWorn ? 'translate-x-4' : 'translate-x-0'"
                class="pointer-events-none inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
              />
            </Switch>
            <span class="text-sm ml-2 pb-1 align-middle" :class="{ 'text-gray-400': !itemWorn }">{{
              itemWorn ? `Item equipped (${itemWornType})` : 'Item not equipped'
            }}</span>
          </div>
          <div
            v-if="
              item?.system.equipped.carryType === 'worn' &&
              (item.system.equipped.invested === true || item.system.equipped.invested === false)
            "
            class="flex"
          >
            <Switch
              v-model="itemInvested"
              :class="itemInvested ? 'bg-green-600' : 'bg-gray-500'"
              class="relative inline-flex h-[18px] w-[34px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
            >
              <span class="sr-only">Item invested?</span>
              <span
                aria-hidden="true"
                :class="itemInvested ? 'translate-x-4' : 'translate-x-0'"
                class="pointer-events-none inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
              />
            </Switch>
            <span
              class="text-sm ml-2 pb-1 align-middle"
              :class="{ 'text-gray-400': !itemInvested }"
              >{{ itemInvested ? `Item invested` : 'Item not invested' }}</span
            >
          </div>
          <div
            v-if="
              item?.system.equipped.carryType === 'stowed' &&
              (actor?.items.filter((i: Item) => i.type === 'backpack').length ?? 0) > 1
            "
          >
            <Listbox as="div" class="w-full" v-model="itemLocation">
              <ListboxButton
                class="relative max-w-full w-full cursor-default rounded-lg bg-white border py-2 pl-3 pr-10 text-left focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
                ><span class="block truncate">{{
                  actor?.items.find((i: Item) => i._id === item?.system.containerId)?.name
                }}</span>
                <span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <ChevronUpDownIcon class="h-5 w-5 text-gray-400" aria-hidden="true" /> </span
              ></ListboxButton>
              <transition
                leave-active-class="transition duration-100 ease-in"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
              >
                <ListboxOptions
                  class="absolute w-[calc(100%-3rem)] max-h-20 mt-1 max-w-[53rem] overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm"
                >
                  <ListboxOption
                    v-slot="{ active, selected }"
                    v-for="container in actor?.items.filter((i: Item) => i.type === 'backpack')"
                    :key="container._id"
                    :value="container._id"
                  >
                    <li
                      :class="[
                        active ? 'bg-amber-100 text-amber-900' : 'text-gray-900',
                        'relative cursor-default select-none py-2 pl-10 pr-4'
                      ]"
                    >
                      <span :class="[selected ? 'font-medium' : 'font-normal', 'block truncate']">{{
                        container.name
                      }}</span>
                      <span
                        v-if="selected"
                        class="absolute inset-y-0 left-0 flex items-center pl-3 text-amber-600"
                      >
                        <CheckIcon class="h-5 w-5" aria-hidden="true" />
                      </span>
                    </li>
                  </ListboxOption>
                </ListboxOptions>
              </transition>
            </Listbox>
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
