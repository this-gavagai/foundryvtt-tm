<script setup lang="ts">
import type { Equipment } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import { printPrice } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import { useListeners } from '@/composables/listenersOnline'
import { inventoryTypes } from '@/utils/constants'
import { capitalize } from 'lodash-es'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import EquipmentListItem from '@/components/EquipmentListItem.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import DropdownWidget from '@/components/widgets/DropdownWidget.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import ToggleWidget from '@/components/widgets/ToggleWidget.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import ParsedDescription from './ParsedDescription.vue'
import EquipmentBulk from './EquipmentBulk.vue'
import EquipmentHeld from './EquipmentHeld.vue'

const infoModal = ref()
const investedModal = ref()

const character = inject(useKeys().characterKey)!
const { inventory } = character
const { isListening } = useListeners()

const itemViewedId = ref<string | undefined>()
const itemViewed = computed(() =>
  inventory.value?.find((i: Equipment) => i._id === itemViewedId.value)
)
const itemWornType = computed(() => {
  if (itemViewed.value?.type === 'armor') return 'Armor'
  const usage = itemViewed.value?.system?.usage?.value
  if (usage?.slice?.(0, 4) === 'worn' && usage?.slice?.(4)) {
    return usage?.slice(4)
  } else return null
})

const toggleSet = [
  {
    id: '1hand',
    toggleText: '1-Hand',
    toggleTrigger: () => itemViewed.value?.changeCarry?.('held', 1, null),
    toggleIsActive: () =>
      itemViewed.value?.system?.equipped.carryType === 'held' &&
      itemViewed.value?.system?.equipped.handsHeld === 1
  },
  {
    id: '2hands',
    toggleText: '2-Hands',
    toggleTrigger: () => itemViewed.value?.changeCarry?.('held', 2, null),
    toggleIsActive: () =>
      itemViewed.value?.system?.equipped.carryType === 'held' &&
      itemViewed.value?.system?.equipped.handsHeld === 2
  },
  {
    id: 'worn',
    toggleText: 'Worn',
    toggleTrigger: () => itemViewed.value?.changeCarry?.('worn', 0, null),
    toggleIsActive: () => itemViewed.value?.system?.equipped.carryType === 'worn'
  },
  {
    id: 'stowed',
    toggleText: 'Stowed',
    toggleTrigger: () => {
      const backpackId = inventory.value?.find((i: Equipment) => i.type === 'backpack')?._id
      itemViewed.value?.changeCarry?.('stowed', 0, backpackId)
    },
    toggleIsActive: () => itemViewed.value?.system?.equipped.carryType === 'stowed'
  },
  {
    id: 'dropped',
    toggleText: 'Dropped',
    toggleTrigger: () => itemViewed.value?.changeCarry?.('dropped', 0, null),
    toggleIsActive: () => itemViewed.value?.system?.equipped.carryType === 'dropped'
  }
]
</script>
<template>
  <div>
    <div v-if="inventory?.length === 0" class="px-6 py-4 italic">
      This character has no inventory.
    </div>
    <div v-else class="px-6 py-4">
      <!-- Held Items list -->
      <EquipmentHeld
        @item-clicked="
          (item) => {
            itemViewedId = item._id
            infoModal.open()
          }
        "
      />
      <EquipmentBulk v-if="inventory?.length" />
      <div v-if="inventory?.length">
        <span class="cursor-pointer text-sm text-gray-500" @click="investedModal.open()">
          (Items Invested:
          {{ inventory?.filter((i: Equipment) => i.system?.equipped?.invested).length }} / 10)
        </span>
      </div>
      <!-- Comprehensive equipment list -->
      <div class="lg:columns-2 lg:gap-12">
        <section
          v-for="inventoryType in inventoryTypes"
          class="break-before-avoid break-inside-avoid-column pt-4 whitespace-nowrap [&:not(:has(li))]:hidden"
          :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
          :key="inventoryType.title"
        >
          <h3 class="text-lg underline only:hidden">{{ inventoryType.title }}</h3>
          <ul>
            <li
              v-for="item in inventory?.filter(
                (i: Equipment) => i.type === inventoryType.type && !i.system?.containerId
              )"
              :key="item._id"
            >
              <EquipmentListItem
                :item="item"
                @item-clicked="
                  () => {
                    itemViewedId = item._id
                    infoModal.open()
                  }
                "
              />
              <!-- Sub-items (in container) -->
              <ul class="pb-2" v-if="item.type === 'backpack'">
                <li
                  v-for="stowed in inventory?.filter(
                    (i: Equipment) => i.system?.containerId === item._id
                  )"
                  :key="stowed._id"
                >
                  <EquipmentListItem
                    :item="stowed"
                    @item-clicked="
                      () => {
                        itemViewedId = stowed._id
                        infoModal.open()
                      }
                    "
                  />
                </li>
              </ul>
            </li>
          </ul>
        </section>
      </div>
    </div>
    <Teleport to="#modals">
      <Modal ref="investedModal" title="Invested Items">
        <EquipmentInvested />
      </Modal>
      <InfoModal
        ref="infoModal"
        :itemId="itemViewed?._id"
        :imageUrl="itemViewed?.img"
        :traits="itemViewed?.system?.traits?.value"
      >
        <template #title>
          {{ itemViewed?.label ?? itemViewed?.name }}
        </template>
        <template #description>
          Level {{ itemViewed?.system?.level?.value }}
          <span class="text-sm capitalize">
            ({{ itemViewed?.system?.traits?.rarity }}),
            {{ printPrice(itemViewed?.system?.price?.value) }}
          </span>
        </template>
        <template #beforeBody>
          <div class="my-2">
            <ChoiceWidget
              v-if="itemViewed?.type !== 'backpack'"
              class="w-full"
              :selected="toggleSet.find((t) => t.toggleIsActive())?.id"
              :choiceSet="toggleSet.map((t) => t.id)"
              :labelSet="toggleSet.reduce((acc, cur) => ({ ...acc, [cur.id]: cur.toggleText }), {})"
              :clicked="
                (newChoice) => {
                  if (itemViewed?.type === 'backpack') return null
                  else return toggleSet.find((t) => t.id === newChoice)?.toggleTrigger()
                }
              "
            />
            <Transition
              enter-active-class="transform transition-all duration-100 overflow-hidden"
              enter-from-class="opacity-0 max-h-0"
              enter-to-class="opacity-100 max-h-6"
              leave-active-class="transform transition-all duration-100 ease-in overflow-hidden"
              leave-from-class="opacity-100 max-h-6"
              leave-to-class="opacity-0 max-h-0"
            >
              <div
                v-if="itemViewed?.system.equipped.carryType === 'worn' && itemWornType"
                class="flex h-6"
              >
                <ToggleWidget
                  :active="itemViewed?.system?.equipped?.inSlot"
                  :clicked="
                    () =>
                      itemViewed?.changeCarry?.(
                        itemViewed?.system?.equipped?.carryType,
                        itemViewed?.system?.equipped?.handsHeld,
                        itemViewed?.system?.containerId,
                        !itemViewed?.system?.equipped?.inSlot
                      )
                  "
                />
                <span
                  class="text-md ml-2 align-middle"
                  :class="{ 'text-gray-400': !itemViewed?.system?.equipped?.inSlot }"
                  >{{
                    itemViewed?.system?.equipped?.inSlot
                      ? `Item equipped (${capitalize(itemWornType)})`
                      : 'Item not equipped'
                  }}</span
                >
              </div>
            </Transition>
            <div
              class="flex py-1"
              v-if="
                itemViewed?.system?.equipped?.carryType === 'worn' &&
                (itemViewed?.system?.equipped?.invested === true ||
                  itemViewed?.system?.equipped?.invested === false)
              "
            >
              <ToggleWidget
                :active="itemViewed?.system.equipped.invested"
                :clicked="() => itemViewed?.toggleInvested?.(!itemViewed.system.equipped.invested)"
              />
              <span
                class="text-md ml-2 align-middle"
                :class="{ 'text-gray-400': !itemViewed?.system.equipped.invested }"
                >{{
                  itemViewed?.system.equipped.invested ? `Item invested` : 'Item not invested'
                }}</span
              >
            </div>
            <Transition
              enter-active-class="transform transition-all duration-100 overflow-hidden"
              enter-from-class="opacity-0 max-h-0"
              enter-to-class="opacity-100 max-h-6"
              leave-active-class="transform transition-all duration-100 ease-in overflow-hidden"
              leave-from-class="opacity-100 max-h-6"
              leave-to-class="opacity-0 max-h-0"
            >
              <div
                v-if="
                  itemViewed?.system?.equipped?.carryType === 'stowed' &&
                  (inventory?.filter((i: Equipment) => i.type === 'backpack').length ?? 0) > 1 &&
                  itemViewed?.type !== 'backpack'
                "
              >
                <DropdownWidget
                  :list="
                    inventory
                      ?.filter((i: Equipment) => i.type === 'backpack')
                      .map((e) => ({ id: e._id ?? '', name: e.name ?? '' })) ?? []
                  "
                  :selectedId="itemViewed?.system?.containerId ?? ''"
                  :changed="
                    (newValue) =>
                      itemViewed?.changeCarry?.(
                        itemViewed?.system?.equipped?.carryType,
                        itemViewed?.system?.equipped?.handsHeld,
                        newValue
                      )
                  "
                  growContainer
                />
              </div>
            </Transition>
          </div>
        </template>
        <template #body>
          <ParsedDescription :text="itemViewed?.system?.description.value" />
          <div class="flex">
            <div class="flex-1 text-xl">Qty: {{ itemViewed?.system?.quantity }}</div>
            <div
              class="ml-auto flex justify-end gap-1"
              v-if="itemViewed?.system?.uses?.value !== undefined"
            >
              <div class="text-xl">Uses:</div>
              <CounterWidget
                :title="itemViewed?.name + ' (uses)'"
                class="mt-1 h-6"
                :value="itemViewed?.system?.uses?.value"
                :max="itemViewed?.system?.uses?.max"
                @changeCount="(newValue: number) => itemViewed?.changeUses?.(newValue)"
                editable
              />
            </div>
          </div>
        </template>
        <template #actionButtons v-if="itemViewed">
          <div class="flex gap-2">
            <Button
              color="lightgray"
              :clicked="() => itemViewed?.changeQty?.((itemViewed?.system?.quantity ?? NaN) + 1)"
            >
              +
            </Button>
            <Button
              color="lightgray"
              :clicked="() => itemViewed?.changeQty?.((itemViewed?.system?.quantity ?? NaN) - 1)"
            >
              -
            </Button>
          </div>
          <div class="flex gap-2">
            <Button
              color="red"
              v-if="
                inventory?.filter((i) => i.system?.containerId === itemViewed?._id).length === 0
              "
              :clicked="
                () => {
                  infoModal.close()
                  return itemViewed?.delete?.()
                }
              "
            >
              Delete
            </Button>
            <Button
              v-if="isListening && itemViewed?.system?.uses?.max"
              color="green"
              :disabled="itemViewed?.system?.uses?.value === 0"
              :clicked="() => itemViewed?.consumeItem?.().then(() => infoModal.close())"
              >Use Item</Button
            >
          </div>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
