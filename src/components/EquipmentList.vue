<script setup lang="ts">
import type { InventoryItem } from '@/composables/character'
import { ref, computed } from 'vue'
import { printPrice } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { inventoryTypes } from '@/utils/constants'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import EquipmentListItem from '@/components/EquipmentListItem.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import EquipmentDetails from '@/components/EquipmentDetails.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import EquipmentBulk from './EquipmentBulk.vue'
import EquipmentHeld from './EquipmentHeld.vue'

const infoModal = ref()
const investedModal = ref()
const equipmentDetails = ref<InstanceType<typeof EquipmentDetails>>()
const inlineRolls = useRollsFromActiveRoll(computed(() => equipmentDetails.value?.activeRoll))

const character = useInjectedCharacter()
const { inventory, rollOptionLabels } = character
const { isListening } = storeToRefs(useListenersStore())

const itemViewedId = ref<string | undefined>()
const itemViewed = computed(() =>
  inventory.value?.find((i: InventoryItem) => i._id === itemViewedId.value)
)
const itemHasContents = computed(() =>
  inventory.value?.some((item) => item.system?.containerId === itemViewed.value?._id)
)

function viewItem(item: InventoryItem) {
  itemViewedId.value = item._id
  infoModal.value.open()
}

function deleteViewedItem() {
  infoModal.value.close()
  return itemViewed.value?.delete?.()
}
</script>
<template>
  <div data-component="EquipmentList">
    <div v-if="inventory?.length === 0" class="px-6 py-4 italic">
      {{ $t('equipment.noInventory') }}
    </div>
    <div v-else class="px-6 py-4">
      <!-- Held Items list -->
      <EquipmentHeld @item-clicked="viewItem" />
      <div v-if="inventory?.length" class="mb-4 flex items-center gap-2">
        <!-- Wrap in a block flex item: an inline <svg width="100%"> collapses to
             0 width when it is itself the flex child (WebKit/iOS), hiding the bar. -->
        <div class="min-w-0 flex-1">
          <EquipmentBulk />
        </div>
        <button
          type="button"
          data-part="invested-count"
          class="cursor-pointer whitespace-nowrap"
          @click="investedModal.open()"
        >
          {{
            $t('equipment.investedCount', {
              count: inventory?.filter((i: InventoryItem) => i.system?.equipped?.invested).length
            })
          }}
        </button>
      </div>
      <!-- Comprehensive equipment list -->
      <div class="lg:columns-2">
        <section
          v-for="inventoryType in inventoryTypes"
          :data-section="inventoryType.type"
          class="break-before-avoid break-inside-avoid-column pt-4 whitespace-nowrap [&:not(:has(li))]:hidden"
          :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
          :key="inventoryType.type"
        >
          <h3 class="text-lg underline only:hidden">{{ $t(inventoryType.titleKey) }}</h3>
          <ul>
            <li
              v-for="item in inventory?.filter(
                (i: InventoryItem) => i.type === inventoryType.type && !i.system?.containerId
              )"
              :key="item._id"
            >
              <EquipmentListItem :item="item" @item-clicked="viewItem(item)" />
              <!-- Sub-items (in container) -->
              <ul class="pb-2" v-if="item.type === 'backpack'">
                <li
                  v-for="stowed in inventory?.filter(
                    (i: InventoryItem) => i.system?.containerId === item._id
                  )"
                  :key="stowed._id"
                >
                  <EquipmentListItem :item="stowed" @item-clicked="viewItem(stowed)" />
                </li>
              </ul>
            </li>
          </ul>
        </section>
      </div>
    </div>
    <Teleport to="#modals">
      <Modal ref="investedModal" :title="$t('equipment.investedTitle')">
        <EquipmentInvested />
      </Modal>
      <InfoModal
        ref="infoModal"
        :itemId="itemViewed?._id"
        :imageUrl="itemViewed?.img"
        :traits="itemViewed?.system?.traits?.value"
        :rolls="inlineRolls"
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
        <template #body>
          <EquipmentDetails
            ref="equipmentDetails"
            :item="itemViewed"
            :inventory="inventory"
            :labels="rollOptionLabels"
          />
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
            <Button color="red" v-if="!itemHasContents" :clicked="deleteViewedItem">
              {{ $t('common.delete') }}
            </Button>
            <Button
              v-if="isListening && itemViewed?.system?.uses?.max"
              color="green"
              :disabled="itemViewed?.system?.uses?.value === 0"
              :clicked="() => itemViewed?.consumeItem?.()"
            >
              {{ $t('equipment.useItem') }}
            </Button>
          </div>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
