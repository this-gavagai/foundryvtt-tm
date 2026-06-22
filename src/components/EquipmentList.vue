<script setup lang="ts">
import type { InventoryItem } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { useCharacterItems } from '@/composables/character/characterItems'
import type { TablemateCharacter } from '@/types/character-types'
import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import { nextTick, ref, computed, watch } from 'vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { EllipsisVerticalIcon } from '@heroicons/vue/24/outline'
import { printPrice } from '@/utils/formatters'
import { getPath } from '@/utils/utilities'
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
const attachModal = ref()
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
const slideDirection = ref<'left' | 'right'>('left')

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
const frozenItem = ref<InventoryItem | undefined>()
watch(itemViewed, (val) => {
  if (val !== undefined) frozenItem.value = val
})
const itemHasContents = computed(() =>
  displayInventory.value?.some((item) => item.system?.containerId === frozenItem.value?._id)
)
const frozenItemUnidentified = computed(
  () => frozenItem.value?.system?.identification?.status === 'unidentified'
)
// Attached items (shield bosses, etc.) aren't top-level inventory entries, so
// they have no carry/container/quantity controls — the modal shows them read-only.
const frozenItemIsSubitem = computed(
  () =>
    frozenItem.value !== undefined &&
    !displayInventory.value?.some((i: InventoryItem) => i._id === frozenItem.value?._id)
)
// Items with an `attached-to-*` trait can attach onto a compatible parent item.
const frozenItemAttachTrait = computed(() =>
  frozenItem.value?.system?.traits?.value?.find((t) => t?.startsWith('attached-to-'))
)
// Best-effort match of attach target to inventory items; Foundry validates the
// actual attach, so an over-broad match just shows a button that may no-op.
function matchesAttachTarget(item: InventoryItem, target: string) {
  if (item.type === target) return true // e.g. attached-to-shield → shield
  if (target === 'crossbow' || target.includes('weapon')) return item.type === 'weapon'
  return false
}
// Candidate parents for a loose attachable item (empty once it's attached).
const attachCandidates = computed(() => {
  const trait = frozenItemAttachTrait.value
  if (!trait || frozenItemIsSubitem.value) return []
  const target = trait.replace('attached-to-', '')
  return (
    displayInventory.value?.filter(
      (i: InventoryItem) => i._id !== frozenItem.value?._id && matchesAttachTarget(i, target)
    ) ?? []
  )
})

function attachToItem(parentId: string) {
  frozenItem.value?.attachTo?.(parentId)
  attachModal.value?.close()
  infoModal.value.close()
}
function detachViewedItem() {
  frozenItem.value?.detach?.()
  infoModal.value.close()
}

function setInventoryMode(val: string) {
  slideDirection.value = val === 'party' ? 'left' : 'right'
  inventoryMode.value = val as 'individual' | 'party'
}

function onBeforeLeave(el: Element) {
  const h = el as HTMLElement
  h.style.position = 'absolute'
  h.style.top = '0'
  h.style.left = '0'
  h.style.width = h.offsetWidth + 'px'
}

function onAfterLeave(el: Element) {
  const h = el as HTMLElement
  h.style.position = ''
  h.style.top = ''
  h.style.left = ''
  h.style.width = ''
}

function viewItem(item: InventoryItem) {
  equipmentActiveRoll.value = undefined
  itemViewedId.value = item._id
  frozenItem.value = item
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
    // The backpack the item was stowed in doesn't exist in the target inventory,
    // so drop the reference rather than carrying a dangling containerId across.
    delete (raw.system as Record<string, unknown>).containerId
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
      <!-- Content: two always-rendered panels toggled with v-show to avoid DOM churn during transition -->
      <div class="relative overflow-hidden">
        <!-- ChoiceWidget anchored at top-right, stays fixed while panels slide -->
        <ChoiceWidget
          v-if="partyActorId"
          class="absolute top-0 right-0 z-10"
          :choiceSet="['individual', 'party']"
          :iconSet="{ individual: meepleIcon, party: meepleGroupIcon }"
          :selected="inventoryMode"
          size="sm"
          @changed="setInventoryMode"
        />
        <!-- Individual inventory panel -->
        <Transition
          enter-active-class="duration-200 linear transform overflow-hidden"
          :enter-from-class="
            'transform opacity-0 ' +
            (slideDirection === 'left' ? 'translate-x-8' : '-translate-x-8')
          "
          enter-to-class="opacity-100"
          leave-active-class="duration-200 linear transform overflow-hidden"
          leave-from-class="opacity-100"
          :leave-to-class="
            'transform opacity-0 ' +
            (slideDirection === 'left' ? '-translate-x-8' : 'translate-x-8')
          "
          @before-leave="onBeforeLeave"
          @after-leave="onAfterLeave"
        >
          <div v-show="!showPartyInventory">
            <!-- Right padding prevents EquipmentHeld text from running under the ChoiceWidget -->
            <div data-part="held-items" :class="partyActorId ? 'min-h-10 pr-28' : ''">
              <EquipmentHeld @item-clicked="viewItem" />
            </div>
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
                    count: inventory?.filter((i: InventoryItem) => i.system?.equipped?.invested)
                      .length
                  })
                }}
              </button>
            </div>
            <div class="gap-8 xl:columns-2">
              <section
                v-for="inventoryType in inventoryTypes"
                :data-section="inventoryType.type"
                class="break-before-avoid break-inside-avoid-column pt-4 whitespace-nowrap [&:not(:has(li))]:hidden"
                :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
                :key="inventoryType.type"
              >
                <h3 class="text-[1.1rem] font-normal tracking-[0.01em] only:hidden">
                  {{ $t(inventoryType.titleKey) }}
                </h3>
                <ul>
                  <li
                    v-for="item in inventory?.filter(
                      (i: InventoryItem) => i.type === inventoryType.type && !i.system?.containerId
                    )"
                    :key="item._id"
                  >
                    <EquipmentListItem :item="item" @item-clicked="viewItem" />
                    <ul class="pb-2" v-if="item.type === 'backpack'">
                      <li
                        v-for="stowed in inventory?.filter(
                          (i: InventoryItem) => i.system?.containerId === item._id
                        )"
                        :key="stowed._id"
                      >
                        <EquipmentListItem :item="stowed" @item-clicked="viewItem" />
                      </li>
                    </ul>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </Transition>

        <!-- Party inventory panel (only mounted when a party actor exists) -->
        <Transition
          v-if="partyActorId"
          enter-active-class="duration-200 linear transform overflow-hidden"
          :enter-from-class="
            'transform opacity-0 ' +
            (slideDirection === 'left' ? 'translate-x-8' : '-translate-x-8')
          "
          enter-to-class="opacity-100"
          leave-active-class="duration-200 linear transform overflow-hidden"
          leave-from-class="opacity-100"
          :leave-to-class="
            'transform opacity-0 ' +
            (slideDirection === 'left' ? '-translate-x-8' : 'translate-x-8')
          "
          @before-leave="onBeforeLeave"
          @after-leave="onAfterLeave"
        >
          <div v-show="showPartyInventory">
            <!-- Title row matches ChoiceWidget height so list starts at the same vertical offset as individual panel content -->
            <div class="flex h-12 items-start pr-28">
              <h2 class="text-xl font-semibold">{{ $t('equipment.partyStash') }}</h2>
            </div>
            <div class="gap-8 xl:columns-2">
              <section
                v-for="inventoryType in inventoryTypes"
                :data-section="inventoryType.type"
                class="break-before-avoid break-inside-avoid-column pt-4 whitespace-nowrap [&:not(:has(li))]:hidden"
                :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
                :key="inventoryType.type"
              >
                <h3 class="text-[1.1rem] font-normal tracking-[0.01em] only:hidden">
                  {{ $t(inventoryType.titleKey) }}
                </h3>
                <ul>
                  <li
                    v-for="item in partyInventory?.filter(
                      (i: InventoryItem) => i.type === inventoryType.type && !i.system?.containerId
                    )"
                    :key="item._id"
                  >
                    <EquipmentListItem :item="item" @item-clicked="viewItem" />
                    <ul class="pb-2" v-if="item.type === 'backpack'">
                      <li
                        v-for="stowed in partyInventory?.filter(
                          (i: InventoryItem) => i.system?.containerId === item._id
                        )"
                        :key="stowed._id"
                      >
                        <EquipmentListItem :item="stowed" @item-clicked="viewItem" />
                      </li>
                    </ul>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </Transition>
      </div>
    </div>
    <Teleport to="#modals">
      <Modal ref="investedModal" :title="$t('equipment.investedTitle')">
        <EquipmentInvested />
      </Modal>
      <InfoModal
        ref="infoModal"
        :itemId="frozenItem?._id"
        :imageUrl="frozenItem?.img"
        :traits="frozenItemUnidentified ? undefined : frozenItem?.system?.traits?.value"
        :rolls="inlineRolls"
      >
        <template #headerActions v-if="frozenItem && !frozenItemIsSubitem">
          <Menu as="div" class="relative flex">
            <MenuButton
              type="button"
              data-part="equipment-menu-button"
              class="cursor-pointer rounded-md focus:outline-hidden"
              :aria-label="$t('common.actions')"
            >
              <EllipsisVerticalIcon class="h-6 w-6" aria-hidden="true" />
            </MenuButton>
            <MenuItems
              data-part="equipment-menu-items"
              class="absolute top-full right-0 z-20 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 text-sm font-semibold shadow-lg ring-1 ring-black/5 focus:outline-hidden"
            >
              <MenuItem v-slot="{ active }" :disabled="itemHasContents">
                <button
                  type="button"
                  data-action="delete"
                  data-part="equipment-menu-item"
                  class="block w-full px-3 py-2 text-left text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  :data-active="active ? true : undefined"
                  :class="active ? 'bg-red-50' : ''"
                  :disabled="itemHasContents"
                  @click="deleteViewedItem"
                >
                  {{ $t('common.delete') }}
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        </template>
        <template #title>
          {{ frozenItem?.label ?? frozenItem?.name }}
        </template>
        <template #description v-if="!frozenItemUnidentified">
          Level {{ frozenItem?.system?.level?.value }}
          <span class="text-sm capitalize">
            ({{ frozenItem?.system?.traits?.rarity }}),
            {{ printPrice(frozenItem?.system?.price?.value) }}
          </span>
        </template>
        <template #body>
          <EquipmentDetails
            ref="equipmentDetails"
            :item="frozenItem"
            :inventory="displayInventory"
            :labels="rollOptionLabels"
            :hideCarryType="showPartyInventory"
            :isSubitem="frozenItemIsSubitem"
            :inventoryMode="partyActorId ? inventoryMode : undefined"
            @moveToInventory="moveItemToInventory"
            @update:activeRoll="equipmentActiveRoll = $event"
          />
        </template>
        <template #actionButtons v-if="frozenItem">
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              v-if="isListening && frozenItem?.system?.uses?.max && !frozenItemUnidentified"
              color="green"
              :disabled="itemViewed?.system?.uses?.value === 0"
              :clicked="
                () => {
                  itemViewed?.consumeItem?.()
                  infoModal.close()
                }
              "
            >
              {{ $t('equipment.useItem') }}
            </Button>
            <Button
              v-if="isListening && frozenItemIsSubitem && frozenItem?.detach"
              color="blue"
              :clicked="detachViewedItem"
            >
              {{ $t('equipment.detach') }}
            </Button>
            <!-- One candidate: attach directly. Several: open a picker that scales. -->
            <Button
              v-if="isListening && frozenItem?.attachTo && attachCandidates.length === 1"
              color="blue"
              :clicked="() => attachToItem(attachCandidates[0]._id!)"
            >
              {{
                $t('equipment.attachTo', {
                  parent: attachCandidates[0].label ?? attachCandidates[0].name
                })
              }}
            </Button>
            <Button
              v-else-if="isListening && frozenItem?.attachTo && attachCandidates.length > 1"
              color="blue"
              :clicked="() => attachModal.open()"
            >
              {{ $t('equipment.attach') }}
            </Button>
          </div>
        </template>
      </InfoModal>
      <Modal ref="attachModal" :title="$t('equipment.attachTitle')">
        <ul>
          <li v-for="parent in attachCandidates" :key="parent._id">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left active:text-gray-500"
              @click="attachToItem(parent._id!)"
            >
              <img v-if="parent.img" :src="getPath(parent.img)" class="h-6 w-6" alt="" />
              <span class="truncate">{{ parent.label ?? parent.name }}</span>
            </button>
          </li>
        </ul>
      </Modal>
    </Teleport>
  </div>
</template>
