<script setup lang="ts">
import type { Equipment } from '@/composables/character'
import { inject, ref, computed } from 'vue'
import { removeUUIDs, printPrice } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import { inventoryTypes } from '@/utils/constants'
import { capitalize } from 'lodash-es'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import EquipmentListItem from '@/components/EquipmentListItem.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import Button from '@/components/ButtonWidget.vue'
import DropdownWidget from './DropdownWidget.vue'
import CounterWidget from './CounterWidget.vue'
import ToggleWidget from './ToggleWidget.vue'
import ChoiceWidget from './ChoiceWidget.vue'

const infoModal = ref()
const investedModal = ref()

const character = inject(useKeys().characterKey)!
const { inventory } = character
const { max: bulkMax, encumberedAfter: bulkEncumberedAfter } = character.bulk
const { value: bulkValue, normal: bulkNormal } = character.bulk.value

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
  <div v-if="inventory?.length === 0" class="px-6 py-4 italic">
    This character has no inventory.
  </div>
  <div v-else class="px-6 py-4">
    <!-- Held Items list -->
    <ul class="peer transition-all duration-300">
      <TransitionGroup
        enter-active-class="transform duration-300 ease-out"
        enter-from-class=" opacity-0 max-h-0  -translate-x-4"
        enter-to-class="opacity-100 max-h-7"
        leave-active-class="transform duration-200 ease-in"
        leave-from-class="opacity-100 max-h-7"
        leave-to-class=" opacity-0 max-h-0  -translate-x-4"
      >
        <li
          v-for="item in inventory?.filter((i: Equipment) => i.system?.equipped?.handsHeld)"
          class="relative whitespace-nowrap text-xl transition-all duration-300"
          :class="item.name ? 'max-h-200' : 'max-h-0'"
          :key="item._id"
        >
          <a
            class="cursor-pointer"
            @click="
              () => {
                itemViewedId = item._id
                infoModal.open()
              }
            "
          >
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
      </TransitionGroup>
    </ul>
    <hr
      class="transition-all duration-300"
      :class="[
        inventory?.filter((i: Equipment) => i.system?.equipped?.handsHeld)?.length
          ? 'mb-2 mt-4 scale-y-100'
          : 'mb-0 mt-0 scale-y-0'
      ]"
    />
    <!-- Invested Items line -->
    <svg width="100%" height="30" class="trasition-all duration-500">
      <rect
        width="100%"
        height="100%"
        style="fill: #fdd"
        class="trasition-all duration-500 ease-in-out"
      />
      <rect
        :width="((bulkEncumberedAfter ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
        height="100%"
        style="fill: #dfd"
        class="trasition-all duration-500 ease-in-out"
      />
      <rect
        :width="((bulkNormal ?? 0) / (bulkMax ?? 100)) * 100 + '%'"
        height="100%"
        :style="
          'fill: ' +
          ((bulkNormal ?? 0) < (bulkEncumberedAfter ?? 0)
            ? 'lightgreen'
            : (bulkNormal ?? 0) < (bulkMax ?? 0)
              ? 'yellow'
              : 'red')
        "
        class="trasition-all duration-500 ease-in-out"
      />
      <rect
        width="100%"
        height="100%"
        style="fill: transparent; stroke-width: 3; stroke: rgb(100, 100, 100)"
      />
      <text y="20" x="6" stroke="black" font-size="10pt" font-weight="lighter">
        Current Bulk: {{ bulkValue }} / {{ bulkEncumberedAfter }}
      </text>
      <text y="20" x="100%" text-anchor="end" stroke="black" font-size="10pt" font-weight="lighter">
        Max: {{ bulkMax }}&nbsp;&nbsp;
      </text>
    </svg>
    <div v-if="inventory?.length">
      <span class="cursor-pointer text-sm text-gray-500" @click="investedModal.open()">
        (Items Invested:
        {{ inventory?.filter((i: Equipment) => i.system?.equipped?.invested).length }} / 10)
      </span>
    </div>
    <!-- Comprehensive equipment list -->
    <div class="lg:columns-2 lg:gap-12">
      <dl
        v-for="inventoryType in inventoryTypes"
        class="break-before-avoid break-inside-avoid-column whitespace-nowrap pt-4 [&:not(:has(dd))]:hidden"
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
          <EquipmentListItem
            :item="item"
            @item-clicked="
              () => {
                itemViewedId = item._id
                infoModal.open()
              }
            "
          />
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
        </dd>
      </dl>
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
        {{ itemViewed?.name }}
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
          <div v-if="itemViewed?.system.equipped.carryType === 'worn' && itemWornType" class="flex">
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
          <div
            v-if="
              itemViewed?.system?.equipped?.carryType === 'worn' &&
              (itemViewed?.system?.equipped?.invested === true ||
                itemViewed?.system?.equipped?.invested === false)
            "
            class="flex py-1"
          >
            <ToggleWidget
              :active="itemViewed.system.equipped.invested"
              :clicked="() => itemViewed?.toggleInvested?.(!itemViewed.system.equipped.invested)"
            />
            <span
              class="text-md ml-2 align-middle"
              :class="{ 'text-gray-400': !itemViewed.system.equipped.invested }"
              >{{
                itemViewed.system.equipped.invested ? `Item invested` : 'Item not invested'
              }}</span
            >
          </div>

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
        </div>
      </template>
      <template #body>
        <div v-html="removeUUIDs(itemViewed?.system?.description.value)"></div>
        <div class="ml-auto flex justify-end gap-1" v-if="itemViewed?.system?.uses?.value">
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
      </template>
      <template #actionButtons v-if="itemViewed">
        <div class="flex flex-1">Qty: {{ itemViewed?.system?.quantity }}</div>
        <div class="flex gap-2">
          <Button
            color="lightgray"
            :clicked="() => itemViewed?.changeQty?.((itemViewed?.system?.quantity ?? NaN) - 1)"
          >
            -
          </Button>
          <Button
            color="lightgray"
            :clicked="() => itemViewed?.changeQty?.((itemViewed?.system?.quantity ?? NaN) + 1)"
          >
            +
          </Button>
        </div>
        <div class="flex gap-2">
          <Button
            color="red"
            v-if="inventory.filter((i) => i.system?.containerId === itemViewed?._id).length === 0"
            :clicked="
              () => {
                infoModal.close()
                return itemViewed?.delete?.()
              }
            "
          >
            Remove
          </Button>
          <Button
            v-if="itemViewed?.system?.uses?.max"
            color="green"
            :disabled="itemViewed?.system?.uses?.value === 0"
            :clicked="() => itemViewed?.consumeItem?.().then(() => infoModal.close())"
            >Use Item</Button
          >
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
