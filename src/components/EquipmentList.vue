<script setup lang="ts">
import type { InventoryItem } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { useCharacterItems } from '@/composables/character/characterItems'
import type { TablemateCharacter } from '@/types/character-types'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import { nextTick, ref, computed, watch } from 'vue'
import { printPrice } from '@/utils/formatters'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { useWorldStore } from '@/stores/world'
import { inventoryTypes } from '@/utils/constants'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { setupSocketListenersForActor } from '@/api/socketSetup'
import { sendCharacterRequest, fireRefresh } from '@/api/characterSync'
import { modifyDocument, processChanges } from '@/api/documents'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import EquipmentListItem from '@/components/EquipmentListItem.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import EquipmentDetails from '@/components/EquipmentDetails.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import EquipmentBulk from './EquipmentBulk.vue'
import EquipmentHeld from './EquipmentHeld.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import meepleIcon from '@/assets/icons/meeple.svg'
import meepleGroupIcon from '@/assets/icons/meeple-group.svg'

const infoModal = ref()
const investedModal = ref()
const equipmentDetails = ref<InstanceType<typeof EquipmentDetails>>()
const equipmentActiveRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(equipmentActiveRoll)

const character = useInjectedCharacter()
const { inventory, rollOptionLabels, _id } = character
const { isListening } = storeToRefs(useListenersStore())
const { world } = storeToRefs(useWorldStore())

const partyActorId = computed<string | null>(
  () =>
    world.value?.actors?.find(
      (a: ActorPF2e) =>
        a.type === 'party' &&
        !!(a.system as { details?: { members?: { uuid: string }[] } })?.details?.members?.some(
          (m) => m.uuid === `Actor.${_id.value}`
        )
    )?._id ?? null
)

const partyActorRef = ref<TablemateCharacter | undefined>()
const inventoryMode = ref<'individual' | 'party'>('individual')
const showPartyInventory = computed(() => inventoryMode.value === 'party')

watch(
  partyActorId,
  async (id, _, onCleanup) => {
    partyActorRef.value = undefined
    if (!id) {
      inventoryMode.value = 'individual'
      return
    }
    const stopListeners = await setupSocketListenersForActor(id, partyActorRef, () =>
      Promise.resolve(sendCharacterRequest(id))
    )
    sendCharacterRequest(id)
    onCleanup(stopListeners)
  },
  { immediate: true }
)

const partyActorForItems = computed<TablemateCharacter | undefined>(() => {
  if (!partyActorId.value) return undefined
  return (
    partyActorRef.value ??
    (world.value?.actors?.find(
      (a: ActorPF2e) => a._id === partyActorId.value
    ) as unknown as TablemateCharacter)
  )
})

const { inventory: partyInventory } = useCharacterItems(partyActorForItems)

const displayInventory = computed<InventoryItem[] | undefined>(() => {
  if (showPartyInventory.value && partyActorId.value) {
    return partyInventory.value
  }
  return inventory.value
})

const itemViewedId = ref<string | undefined>()
const itemViewed = computed(() =>
  displayInventory.value?.find((i: InventoryItem) => i._id === itemViewedId.value)
)
const itemHasContents = computed(() =>
  displayInventory.value?.some((item) => item.system?.containerId === itemViewed.value?._id)
)

function setInventoryMode(val: string) {
  inventoryMode.value = val as 'individual' | 'party'
}

function viewItem(item: InventoryItem) {
  equipmentActiveRoll.value = undefined
  itemViewedId.value = item._id
  infoModal.value.open()
  nextTick(() => equipmentDetails.value?.initRolls())
}

function deleteViewedItem() {
  infoModal.value.close()
  return itemViewed.value?.delete?.()
}

async function moveItemToInventory(targetMode: 'individual' | 'party') {
  if (!itemViewed.value || !partyActorId.value) return

  const item = itemViewed.value
  const currentQty = item.system?.quantity ?? 1
  const targetActorId = targetMode === 'party' ? partyActorId.value : _id.value
  const targetInventory = targetMode === 'party' ? partyInventory.value : inventory.value

  const existing = targetInventory?.find(
    (i: InventoryItem) => i.name === item.name && i.type === item.type
  )

  let confirmed = false

  if (existing) {
    const response = await existing.changeQty?.((existing.system?.quantity ?? 0) + 1)
    confirmed = Array.isArray(response?.result) && response.result.length > 0
  } else {
    const raw = JSON.parse(JSON.stringify(item)) as Record<string, unknown>
    delete raw._id
    ;(raw.system as Record<string, unknown>).quantity = 1
    const response = await modifyDocument(
      {
        action: 'create',
        type: 'Item',
        operation: { parentUuid: `Actor.${targetActorId}`, data: [raw] }
      },
      (r) => {
        if (targetMode === 'party' && partyActorRef.value?.items) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          processChanges(r, partyActorRef.value.items as any)
        }
        fireRefresh(targetActorId)
      }
    )
    confirmed = Array.isArray(response?.result) && response.result.length > 0
  }

  if (!confirmed) return

  if (currentQty <= 1) {
    await item.delete?.()
    infoModal.value.close()
  } else {
    await item.changeQty?.(currentQty - 1)
  }
}
</script>
<template>
  <div data-component="EquipmentList">
    <div v-if="displayInventory?.length === 0" class="px-6 py-4 italic">
      {{ $t('equipment.noInventory') }}
    </div>
    <div v-else class="px-6 py-4">
      <!-- Held items + inventory mode selector -->
      <div class="flex items-start">
        <div class="min-w-0 flex-1">
          <EquipmentHeld v-if="!showPartyInventory" @item-clicked="viewItem" />
        </div>
        <ChoiceWidget
          v-if="partyActorId"
          :choiceSet="['individual', 'party']"
          :iconSet="{ individual: meepleIcon, party: meepleGroupIcon }"
          :selected="inventoryMode"
          size="sm"
          @changed="setInventoryMode"
        />
      </div>
      <div
        v-if="displayInventory?.length && !showPartyInventory"
        class="mb-4 flex items-center gap-2"
      >
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
              v-for="item in displayInventory?.filter(
                (i: InventoryItem) => i.type === inventoryType.type && !i.system?.containerId
              )"
              :key="item._id"
            >
              <EquipmentListItem :item="item" @item-clicked="viewItem(item)" />
              <!-- Sub-items (in container) -->
              <ul class="pb-2" v-if="item.type === 'backpack'">
                <li
                  v-for="stowed in displayInventory?.filter(
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
            :inventory="displayInventory"
            :labels="rollOptionLabels"
            :hideCarryType="showPartyInventory"
            :inventoryMode="partyActorId ? inventoryMode : undefined"
            @moveToInventory="moveItemToInventory"
            @update:activeRoll="equipmentActiveRoll = $event"
          />
        </template>
        <template #actionButtons v-if="itemViewed">
          <div class="flex flex-wrap justify-end gap-2">
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
            <Button color="red" v-if="!itemHasContents" :clicked="deleteViewedItem">
              {{ $t('common.delete') }}
            </Button>
            <Button
              v-if="isListening && itemViewed?.system?.uses?.max"
              color="green"
              :disabled="itemViewed?.system?.uses?.value === 0"
              :clicked="() => { itemViewed?.consumeItem?.(); infoModal.close() }"
            >
              {{ $t('equipment.useItem') }}
            </Button>
          </div>
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
