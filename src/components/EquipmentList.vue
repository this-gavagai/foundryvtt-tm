<script setup lang="ts">
import type { InventoryItem } from '@/composables/character'
import type { ActiveRoll } from '@/types/api-types'
import { nextTick, ref, computed, watch } from 'vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { EllipsisVerticalIcon, PlusCircleIcon, MinusCircleIcon } from '@heroicons/vue/24/outline'
import { printPrice } from '@/utils/formatters'
import { useTraitLabels } from '@/composables/useTraitLabels'
import { getPath } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { inventoryTypes } from '@/utils/constants'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { usePartyTransfer } from '@/composables/usePartyTransfer'
import { isCoin } from '@/utils/coins'

import EquipmentInvested from '@/components/EquipmentInvested.vue'
import EquipmentListItem from '@/components/EquipmentListItem.vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import SheetSection from '@/components/widgets/SheetSection.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import EquipmentDetails from '@/components/EquipmentDetails.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import EquipmentBulk from './EquipmentBulk.vue'
import EquipmentContainerCapacity from './EquipmentContainerCapacity.vue'
import EquipmentCoins from './EquipmentCoins.vue'
import EquipmentHeld from './EquipmentHeld.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import meepleIcon from '@/assets/icons/meeple.svg'
import meepleGroupIcon from '@/assets/icons/meeple-group.svg'

const infoModal = ref()
const investedModal = ref()
const attachModal = ref()
const splitModal = ref()
const mergeModal = ref()
const equipmentDetails = ref<InstanceType<typeof EquipmentDetails>>()
const equipmentActiveRoll = ref<ActiveRoll>()
const inlineRolls = useRollsFromActiveRoll(equipmentActiveRoll)

const character = useInjectedCharacter()
const { inventory, rollOptionLabels, _id, _actor } = character

const { labelFor: rarityLabel } = useTraitLabels()
const { isListening } = storeToRefs(useListenersStore())

// The party-inventory transfer protocol (find the party actor, keep its
// inventory synced, move items with confirmation) lives in its own composable.
const { partyActorId, partyActor, partyInventory, transferItem } = usePartyTransfer({
  characterId: _id,
  characterActor: _actor,
  individualInventory: inventory
})

const inventoryMode = ref<'individual' | 'party'>('individual')
const showPartyInventory = computed(() => inventoryMode.value === 'party')
const slideDirection = ref<'left' | 'right'>('left')

// Leaving a party (or never being in one) returns the view to the individual
// inventory.
watch(partyActorId, (id) => {
  if (!id) inventoryMode.value = 'individual'
})

// Coins have their own panel now, so they come out of the lists: a row reading
// "Gold Pieces (x143)" among the daggers is exactly the item-shaped treatment
// the purse exists to replace. They still count toward Bulk, which PF2e derives
// on the actor rather than from what is rendered here. EquipmentCoins keeps
// reading the unfiltered inventories, since coin stacks are what it edits.
const listedInventory = computed(() => inventory.value?.filter((i: InventoryItem) => !isCoin(i)))
const listedPartyInventory = computed(() =>
  partyInventory.value?.filter((i: InventoryItem) => !isCoin(i))
)

const displayInventory = computed<InventoryItem[] | undefined>(() => {
  if (showPartyInventory.value && partyActorId.value) {
    return listedPartyInventory.value
  }
  return listedInventory.value
})

// A character carrying nothing but coins still has a purse worth showing, so
// the empty state asks the inventory itself rather than the filtered list.
const panelInventory = computed(() =>
  showPartyInventory.value && partyActorId.value ? partyInventory.value : inventory.value
)

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

// A stack of more than one can be divided into two: the picker below chooses how
// many come off, and the rest stay on the original item. Read off `itemViewed`
// (not the frozen snapshot) so the bounds follow the live quantity — someone
// else spending arrows while the modal is open lowers the ceiling.
const splitCount = ref(1)
const maxSplitCount = computed(() => Math.max(1, (itemViewed.value?.system?.quantity ?? 1) - 1))
const canSplitViewedItem = computed(() => (itemViewed.value?.system?.quantity ?? 0) > 1)

function setSplitCount(value: number) {
  if (Number.isNaN(value)) return
  splitCount.value = Math.min(Math.max(Math.floor(value), 1), maxSplitCount.value)
}

function onSplitInput(e: Event) {
  setSplitCount(Number((e.target as HTMLInputElement).value))
}

function openSplitModal() {
  // Half the stack is the split people reach for most often, so it's the
  // number already in the box; the picker is there for every other split.
  setSplitCount(Math.floor((itemViewed.value?.system?.quantity ?? 2) / 2))
  splitModal.value?.open()
}

// The detail modal stays open on the item that was split: its quantity is now
// the remainder, which is the answer to "did that do what I meant?".
async function splitViewedItem() {
  const count = Math.min(splitCount.value, maxSplitCount.value)
  await itemViewed.value?.splitStack?.(count)
  splitModal.value?.close()
}

// The other stacks the viewed item could absorb. Offered whenever one exists —
// quantity 1 included, since two lone arrows are exactly the case worth
// merging, which makes this a different gate from the split's. Only the item
// itself can answer: PF2e's stackability rule compares whole documents, and the
// sheet's item model keeps too little of one (utils/itemStacks).
const mergeCandidates = computed<InventoryItem[]>(() => {
  const ids = itemViewed.value?.stackableIds?.() ?? []
  return (displayInventory.value ?? []).filter((i: InventoryItem) => i._id && ids.includes(i._id))
})
const mergeTotal = computed(
  () =>
    (itemViewed.value?.system?.quantity ?? 0) +
    mergeCandidates.value.reduce((sum, i) => sum + (i.system?.quantity ?? 0), 0)
)

// One candidate needs no picker — the menu row already names it. Several do.
function mergeClicked() {
  const only = mergeCandidates.value.length === 1 ? mergeCandidates.value[0]._id : undefined
  if (only) return mergeStacks([only])
  mergeModal.value?.open()
}

// The viewed item is always the survivor, so the detail modal stays open and
// its Qty ticks up — the inverse of a split leaving the remainder in front of
// you. mergeStack re-checks stackability, so a stale id is dropped, not merged.
async function mergeStacks(sourceIds: string[]) {
  await itemViewed.value?.mergeStack?.(sourceIds)
  mergeModal.value?.close()
}

// Thin view-side wrapper over the transfer protocol: supply the viewed item,
// and close the detail modal when the source copy was fully removed.
async function moveItemToInventory(targetMode: 'individual' | 'party') {
  if (!itemViewed.value) return
  const { removed } = await transferItem(itemViewed.value, targetMode)
  if (removed) infoModal.value.close()
}
</script>
<template>
  <div data-component="EquipmentList">
    <div v-if="panelInventory?.length === 0" class="px-6 pt-4 pb-8 italic">
      {{ $t('equipment.noInventory') }}
    </div>
    <div v-else class="px-6 pt-4 pb-8">
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
            <!-- The invested pill is the taller of the two (it matches the
                 purse bar below), so the bulk block centres against it. -->
            <div v-if="inventory?.length" class="mb-3 flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <EquipmentBulk />
              </div>
              <ViewableItem
                data-part="invested-count"
                class="inline-block whitespace-nowrap"
                @click="investedModal.open()"
              >
                {{
                  $t('equipment.investedCount', {
                    count: inventory?.filter((i: InventoryItem) => i.system?.equipped?.invested)
                      .length
                  })
                }}
              </ViewableItem>
            </div>
            <!-- Coins sit directly under the bulk/invested row: fungible, so
                 they get a purse rather than a place in the item lists. -->
            <EquipmentCoins
              class="mb-4"
              :partyActorId="partyActorId"
              :partyActor="partyActor"
              :partyInventory="partyInventory"
            />
            <div class="gap-8 xl:columns-2">
              <SheetSection
                v-for="inventoryType in inventoryTypes"
                :section="inventoryType.type"
                :title="$t(inventoryType.titleKey)"
                class="break-before-avoid break-inside-avoid-column pt-4 whitespace-nowrap [&:not(:has(li))]:hidden"
                :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
                :key="inventoryType.type"
              >
                <ul>
                  <li
                    v-for="item in listedInventory?.filter(
                      (i: InventoryItem) => i.type === inventoryType.type && !i.system?.containerId
                    )"
                    :key="item._id"
                  >
                    <EquipmentListItem :item="item" @item-clicked="viewItem" />
                    <!-- The container's own fill sits between it and what it
                         holds, indented onto the stowed rows it describes. -->
                    <EquipmentContainerCapacity
                      v-if="item.type === 'backpack'"
                      class="mt-0.5 mb-1 ml-3"
                      :capacity="item.capacity"
                    />
                    <ul class="pb-2" v-if="item.type === 'backpack'">
                      <li
                        v-for="stowed in listedInventory?.filter(
                          (i: InventoryItem) => i.system?.containerId === item._id
                        )"
                        :key="stowed._id"
                      >
                        <EquipmentListItem :item="stowed" @item-clicked="viewItem" />
                      </li>
                    </ul>
                  </li>
                </ul>
              </SheetSection>
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
            <!-- The stash keeps coins too, and they are edited the same way. -->
            <EquipmentCoins
              class="mb-4"
              panel="party"
              :partyActorId="partyActorId"
              :partyActor="partyActor"
              :partyInventory="partyInventory"
            />
            <div class="gap-8 xl:columns-2">
              <SheetSection
                v-for="inventoryType in inventoryTypes"
                :section="inventoryType.type"
                :title="$t(inventoryType.titleKey)"
                class="break-before-avoid break-inside-avoid-column pt-4 whitespace-nowrap [&:not(:has(li))]:hidden"
                :class="{ 'break-before-column': inventoryType.type === 'backpack' }"
                :key="inventoryType.type"
              >
                <ul>
                  <li
                    v-for="item in listedPartyInventory?.filter(
                      (i: InventoryItem) => i.type === inventoryType.type && !i.system?.containerId
                    )"
                    :key="item._id"
                  >
                    <EquipmentListItem :item="item" @item-clicked="viewItem" />
                    <EquipmentContainerCapacity
                      v-if="item.type === 'backpack'"
                      class="mt-0.5 mb-1 ml-3"
                      :capacity="item.capacity"
                    />
                    <ul class="pb-2" v-if="item.type === 'backpack'">
                      <li
                        v-for="stowed in listedPartyInventory?.filter(
                          (i: InventoryItem) => i.system?.containerId === item._id
                        )"
                        :key="stowed._id"
                      >
                        <EquipmentListItem :item="stowed" @item-clicked="viewItem" />
                      </li>
                    </ul>
                  </li>
                </ul>
              </SheetSection>
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
              <MenuItem v-if="canSplitViewedItem" v-slot="{ active }">
                <button
                  type="button"
                  data-action="split"
                  data-part="equipment-menu-item"
                  class="block w-full px-3 py-2 text-left"
                  :data-active="active ? true : undefined"
                  :class="active ? 'bg-gray-100' : ''"
                  @click="openSplitModal"
                >
                  {{ $t('equipment.splitStack') }}
                </button>
              </MenuItem>
              <MenuItem v-if="mergeCandidates.length" v-slot="{ active }">
                <button
                  type="button"
                  data-action="merge"
                  data-part="equipment-menu-item"
                  class="block w-full px-3 py-2 text-left"
                  :data-active="active ? true : undefined"
                  :class="active ? 'bg-gray-100' : ''"
                  @click="mergeClicked"
                >
                  {{
                    mergeCandidates.length === 1
                      ? $t('equipment.mergeWith', {
                          count: mergeCandidates[0].system?.quantity ?? 0
                        })
                      : $t('equipment.mergeStack')
                  }}
                </button>
              </MenuItem>
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
          {{ $t('common.level') }} {{ frozenItem?.system?.level?.value }}
          <span class="text-sm">
            <template v-if="frozenItem?.system?.traits?.rarity"
              >({{ rarityLabel(frozenItem?.system?.traits?.rarity) }}),
            </template>
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
            :moveToInventory="moveItemToInventory"
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
      <Modal
        ref="splitModal"
        :title="$t('equipment.splitTitle', { name: frozenItem?.label ?? frozenItem?.name ?? '' })"
      >
        <div class="flex items-center justify-between py-6 text-3xl">
          <Button
            color="unstyled"
            :disabled="splitCount <= 1"
            :clicked="() => setSplitCount(splitCount - 1)"
          >
            <MinusCircleIcon class="h-8 w-8" />
          </Button>
          <input
            type="number"
            min="1"
            :max="maxSplitCount"
            data-part="split-count"
            class="w-28 rounded-md border border-gray-300 py-2 text-center text-3xl"
            :value="splitCount"
            @change="onSplitInput"
          />
          <Button
            color="unstyled"
            :disabled="splitCount >= maxSplitCount"
            :clicked="() => setSplitCount(splitCount + 1)"
          >
            <PlusCircleIcon class="h-8 w-8" />
          </Button>
        </div>
        <!-- Both halves are spelled out: the number in the box is what leaves,
             and the one worth double-checking is what's left behind. -->
        <p data-part="split-summary" class="text-center text-sm">
          {{
            $t('equipment.splitSummary', {
              split: Math.min(splitCount, maxSplitCount),
              remaining: (itemViewed?.system?.quantity ?? 0) - Math.min(splitCount, maxSplitCount)
            })
          }}
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <Button color="lightgray" :clicked="() => splitModal.close()">
            {{ $t('common.cancel') }}
          </Button>
          <Button color="blue" :disabled="!canSplitViewedItem" :clicked="splitViewedItem">
            {{ $t('equipment.splitConfirm') }}
          </Button>
        </div>
      </Modal>
      <!-- Same shape as the attach picker below: the choice is which item, so a
           list of items is the whole interface. -->
      <Modal
        ref="mergeModal"
        :title="$t('equipment.mergeTitle', { name: frozenItem?.label ?? frozenItem?.name ?? '' })"
      >
        <ul>
          <li v-for="candidate in mergeCandidates" :key="candidate._id">
            <button
              type="button"
              data-part="merge-candidate"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left active:text-gray-500"
              @click="mergeStacks([candidate._id!])"
            >
              <img v-if="candidate.img" :src="getPath(candidate.img)" class="h-6 w-6" alt="" />
              <span class="w-full truncate">{{ candidate.label ?? candidate.name }}</span>
              <span class="text-sm">×{{ candidate.system?.quantity }}</span>
            </button>
          </li>
        </ul>
        <button
          v-if="mergeCandidates.length > 1"
          type="button"
          data-part="merge-all"
          class="mt-2 w-full cursor-pointer border-t border-gray-200 pt-2 text-left active:text-gray-500"
          @click="mergeStacks(mergeCandidates.map((c: InventoryItem) => c._id!))"
        >
          {{ $t('equipment.mergeAll', { count: mergeTotal }) }}
        </button>
      </Modal>
      <Modal ref="attachModal" :title="$t('equipment.attachTitle')">
        <ul>
          <li v-for="parent in attachCandidates" :key="parent._id">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left active:text-gray-500"
              @click="attachToItem(parent._id!)"
            >
              <img v-if="parent.img" :src="getPath(parent.img)" class="h-6 w-6" alt="" />
              <span class="w-full truncate">{{ parent.label ?? parent.name }}</span>
            </button>
          </li>
        </ul>
      </Modal>
    </Teleport>
  </div>
</template>
