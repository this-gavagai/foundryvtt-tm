<script setup lang="ts">
// TODO (data): add weight, encumbrance, etc.
// TODO (refactor): switch toggle bar over to headlessui component and give transaction feedback
// TODO (refactor): refactor listbox into component, and give transaction feedback
// TODO (refactor): refactor Switch into component, and give transactionf eedback
// TODO (refactor): it is currently possible to put containers inside themselves, which leads to all sorts of trouble; fix while refactoring how backpacks are rendered?

import type { Equipment } from '@/composables/character'
import { inject, ref, computed, watch } from 'vue'
import { capitalize, removeUUIDs, printPrice } from '@/utils/utilities'
import { inventoryTypes } from '@/utils/constants'
import { useKeys } from '@/composables/injectKeys'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption, Switch } from '@headlessui/vue'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/20/solid'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const investedModal = ref()

const character = inject(useKeys().characterKey)!
const { inventory } = character

const item = computed(() =>
  inventory.value?.find((i: Equipment) => i._id === infoModal?.value?.itemId)
)
const itemWornType = computed(() => {
  if (item.value?.type === 'armor') return 'Armor'
  const usage = item.value?.system?.usage?.value
  if (usage?.slice?.(0, 4) === 'worn' && usage?.slice?.(4)) {
    return capitalize(usage?.slice(4))
  } else return null
})

watch(item, (newValue) => {
  itemLocation.value = newValue?.system?.containerId
  itemWorn.value = newValue?.system?.equipped?.inSlot
  itemInvested.value = newValue?.system?.equipped.invested
})

// values for v-model binding to toggles and widgets in infomodal
const itemLocation = ref(item.value?.system?.containerId)
watch(itemLocation, (newValue) => {
  if (!item.value) return
  const current = item.value?.system?.equipped
  item.value?.changeCarry?.(current?.carryType, current?.handsHeld, newValue)
})
const itemWorn = ref(item.value?.system?.equipped?.inSlot)
watch(itemWorn, (newValue) => {
  if (!item.value) return
  const current = item.value?.system?.equipped
  item.value?.changeCarry?.(
    current?.carryType,
    current?.handsHeld,
    item.value?.system?.containerId,
    newValue
  )
})
const itemInvested = ref(item.value?.system?.equipped.invested)
watch(itemInvested, (newValue) => {
  if (!item.value) return
  item.value?.toggleInvested?.(newValue)
})

const toggleSet = [
  {
    id: '1hand',
    toggleText: '1-Hand',
    toggleTrigger: () => item.value?.changeCarry?.('held', 1, null),
    toggleIsActive: () =>
      item.value?.system?.equipped.carryType === 'held' &&
      item.value?.system?.equipped.handsHeld === 1
  },
  {
    id: '2hands',
    toggleText: '2-Hands',
    toggleTrigger: () => item.value?.changeCarry?.('held', 2, null),
    toggleIsActive: () =>
      item.value?.system?.equipped.carryType === 'held' &&
      item.value?.system?.equipped.handsHeld === 2
  },
  {
    id: 'worn',
    toggleText: 'Worn',
    toggleTrigger: () => item.value?.changeCarry?.('worn', 0, null),
    toggleIsActive: () => item.value?.system?.equipped.carryType === 'worn'
  },
  {
    id: 'stowed',
    toggleText: 'Stowed',
    toggleTrigger: () => {
      const backpackId = inventory.value?.find((i: Equipment) => i.type === 'backpack')?._id
      item.value?.changeCarry?.('stowed', 0, backpackId)
    },
    toggleIsActive: () => item.value?.system?.equipped.carryType === 'stowed'
  },
  {
    id: 'dropped',
    toggleText: 'Dropped',
    toggleTrigger: () => item.value?.changeCarry?.('dropped', 0, null),
    toggleIsActive: () => item.value?.system?.equipped.carryType === 'dropped'
  }
]
</script>
<template>
  <div v-if="inventory?.length === 0" class="px-6 py-4 italic">
    This character has no inventory.
  </div>
  <div v-else class="px-6 py-4">
    <!-- Invested Items tip -->
    <div>
      <span class="cursor-pointer text-sm text-gray-500" @click="investedModal.open()">
        (Invested: {{ inventory?.filter((i: Equipment) => i.system?.equipped?.invested).length }} /
        10)
      </span>
    </div>
    <!-- Held Items list -->
    <ul>
      <li
        v-for="item in inventory?.filter((i: Equipment) => i.system?.equipped?.handsHeld)"
        class="whitespace-nowrap text-2xl"
        :key="item._id"
      >
        <a class="cursor-pointer" @click="infoModal.open(item._id)">
          <span class="pr-1">{{
            item.system?.equipped?.handsHeld
              ? item.system?.equipped?.handsHeld === 1
                ? '❶'
                : '❷'
              : item.system?.equipped?.carryType === 'dropped'
                ? '⌵'
                : 'Ⓦ'
          }}</span>
          <span>{{ item.name }}</span>
        </a>
      </li>
    </ul>
    <!-- Comprehensive equipment list -->
    <div class="lg:columns-2 lg:gap-12">
      <dl
        v-for="inventoryType in inventoryTypes"
        class="break-before-avoid break-inside-avoid-column whitespace-nowrap pt-4"
        :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
        :key="inventoryType.title"
      >
        <dt class="text-lg underline only:hidden">{{ inventoryType.title }}</dt>
        <dd
          v-for="item in inventory?.filter(
            (i: Equipment) => i.type === inventoryType.type && !i.system?.containerId
          )"
          :key="item._id"
        >
          <div
            :class="{
              'text-gray-300': item.system?.equipped?.carryType === 'dropped',
              'text-lg underline': item.type === 'backpack'
            }"
          >
            <a
              class="flex cursor-pointer items-center justify-between gap-1"
              @click="infoModal.open(item._id)"
            >
              <span class="truncate">{{ item.name }}</span>
              <span v-if="item.type !== 'backpack'" class="text-xs">
                (x{{ item?.system?.quantity }})</span
              >
            </a>
          </div>
          <!-- TODO (refactor): this backpack chunk is redundant code to above. split into component? -->
          <ul class="pb-2" v-if="item.type === 'backpack'">
            <li
              v-for="stowed in inventory?.filter(
                (i: Equipment) => i.system?.containerId === item._id
              )"
              :key="stowed._id"
            >
              <a
                class="flex cursor-pointer items-center justify-between gap-1"
                @click="infoModal.open(stowed._id)"
              >
                <span class="truncate">{{ stowed.name }}</span>
                <span class="text-xs">(x{{ item?.system?.quantity }})</span>
              </a>
            </li>
          </ul>
        </dd>
      </dl>
    </div>
  </div>
  <Teleport to="#modals">
    <Modal ref="investedModal" title="Invested Items">
      <EquipmentInvested />
    </Modal>
    <InfoModal ref="infoModal" :imageUrl="item?.img" :traits="item?.system?.traits?.value">
      <template #title>
        {{ item?.name }}
      </template>
      <template #description>
        Level {{ item?.system?.level?.value }}
        <span class="text-sm">
          ({{ capitalize(item?.system?.traits?.rarity) }}),
          {{ printPrice(item?.system?.price?.value) }}
        </span>
      </template>
      <template #beforeBody>
        <div class="my-2">
          <div
            class="mb-2 flex w-full basis-full justify-items-center rounded-md border border-gray-400 text-xs empty:hidden"
          >
            <div
              v-for="t in toggleSet"
              class="flex-auto cursor-pointer border-l border-gray-300 p-2 text-center first:border-none"
              :class="{ 'bg-gray-300': t.toggleIsActive() }"
              @click="t?.toggleTrigger()"
              :key="t.id"
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
              class="relative inline-flex h-[24px] w-[40px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
            >
              <span class="sr-only">Item Worn in Slot?</span>
              <span
                aria-hidden="true"
                :class="itemWorn ? 'translate-x-4' : 'translate-x-0'"
                class="pointer-events-none inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
              />
            </Switch>
            <span class="text-md ml-2 align-middle" :class="{ 'text-gray-400': !itemWorn }">{{
              itemWorn ? `Item equipped (${itemWornType})` : 'Item not equipped'
            }}</span>
          </div>
          <div
            v-if="
              item?.system?.equipped?.carryType === 'worn' &&
              (item?.system?.equipped?.invested === true ||
                item?.system?.equipped?.invested === false)
            "
            class="flex py-1"
          >
            <Switch
              v-model="itemInvested"
              :class="itemInvested ? 'bg-green-600' : 'bg-gray-500'"
              class="relative inline-flex h-[24px] w-[40px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75"
            >
              <span class="sr-only">Item invested?</span>
              <span
                aria-hidden="true"
                :class="itemInvested ? 'translate-x-4' : 'translate-x-0'"
                class="pointer-events-none inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
              />
            </Switch>
            <span class="text-md ml-2 align-middle" :class="{ 'text-gray-400': !itemInvested }">{{
              itemInvested ? `Item invested` : 'Item not invested'
            }}</span>
          </div>
          <div
            v-if="
              item?.system?.equipped?.carryType === 'stowed' &&
              (inventory?.filter((i: Equipment) => i.type === 'backpack').length ?? 0) > 1
            "
          >
            <Listbox as="div" class="w-full" v-model="itemLocation">
              <ListboxButton
                class="relative w-full max-w-full cursor-default rounded-lg border bg-white py-2 pl-3 pr-10 text-left focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
                ><span class="block truncate">{{
                  inventory?.find((i: Equipment) => i._id === item?.system?.containerId)?.name
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
                  class="absolute mt-1 max-h-20 w-[calc(100%-3rem)] max-w-[53rem] overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm"
                >
                  <ListboxOption
                    v-slot="{ active, selected }"
                    v-for="container in inventory?.filter((i: Equipment) => i.type === 'backpack')"
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
        <div v-html="removeUUIDs(item?.system?.description.value)"></div>
      </template>
      <template #actionButtons v-if="item">
        <div class="flex-1">Qty: {{ item?.system?.quantity }}</div>
        <button
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-red-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-red-300 focus:outline-none"
          @click="
            () => {
              item?.delete?.()
              infoModal.close()
            }
          "
        >
          Remove
        </button>
        <button
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-gray-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-300 focus:outline-none"
          @click="() => item?.changeQty?.((item?.system?.quantity ?? NaN) - 1)"
        >
          -
        </button>
        <button
          type="button"
          class="inline-flex items-end justify-center border border-transparent bg-gray-200 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-300 focus:outline-none"
          @click="() => item?.changeQty?.((item?.system?.quantity ?? NaN) + 1)"
        >
          +
        </button>
      </template>
    </InfoModal>
  </Teleport>
</template>
