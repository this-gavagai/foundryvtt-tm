<script setup lang="ts">
import { computed, ref } from 'vue'
import { capitalize } from 'lodash-es'
import type { InventoryItem } from '@/composables/character'

import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import DropdownWidget from '@/components/widgets/DropdownWidget.vue'
import ToggleWidget from '@/components/widgets/ToggleWidget.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'
import meepleIcon from '@/assets/icons/meeple.svg'
import meepleGroupIcon from '@/assets/icons/meeple-group.svg'

const props = defineProps<{
  item?: InventoryItem
  inventory?: InventoryItem[]
  labels?: Record<string, string>
  hideCarryType?: boolean
  inventoryMode?: 'individual' | 'party'
}>()
const emit = defineEmits<{ moveToInventory: [target: 'individual' | 'party'] }>()

const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = computed(() => description.value?.activeRoll)

const itemWornType = computed(() => {
  if (props.item?.type === 'armor') return 'Armor'
  const usage = props.item?.system?.usage?.value
  if (usage?.slice?.(0, 4) === 'worn' && usage?.slice?.(4)) return usage.slice(4)
  return null
})

const backpacks = computed(() => props.inventory?.filter((item) => item.type === 'backpack') ?? [])

const containerList = computed(() => [
  { id: '', name: 'None' },
  ...backpacks.value.map((b) => ({ id: b._id ?? '', name: b.name ?? '' }))
])

function changeContainer(newValue: string) {
  if (newValue) {
    props.item?.changeCarry?.('stowed', 0, newValue)
  } else {
    props.item?.changeCarry?.('worn', 0, null)
  }
}

const carryChoices = computed(() => [
  {
    id: '1hand',
    toggleText: '1-Hand',
    toggleTrigger: () => props.item?.changeCarry?.('held', 1, null),
    toggleIsActive: () =>
      props.item?.system?.equipped.carryType === 'held' &&
      props.item?.system?.equipped.handsHeld === 1
  },
  {
    id: '2hands',
    toggleText: '2-Hands',
    toggleTrigger: () => props.item?.changeCarry?.('held', 2, null),
    toggleIsActive: () =>
      props.item?.system?.equipped.carryType === 'held' &&
      props.item?.system?.equipped.handsHeld === 2
  },
  {
    id: 'worn',
    toggleText: 'Worn',
    toggleTrigger: () => props.item?.changeCarry?.('worn', 0, null),
    toggleIsActive: () => props.item?.system?.equipped.carryType === 'worn'
  },
  {
    id: 'stowed',
    toggleText: 'Stowed',
    toggleTrigger: () => {
      const backpackId = backpacks.value[0]?._id
      props.item?.changeCarry?.('stowed', 0, backpackId)
    },
    toggleIsActive: () => props.item?.system?.equipped.carryType === 'stowed'
  },
  {
    id: 'dropped',
    toggleText: 'Dropped',
    toggleTrigger: () => props.item?.changeCarry?.('dropped', 0, null),
    toggleIsActive: () => props.item?.system?.equipped.carryType === 'dropped'
  }
])

const carryLabels = computed(() =>
  carryChoices.value.reduce<Record<string, string>>((labels, choice) => {
    labels[choice.id] = choice.toggleText
    return labels
  }, {})
)

function selectCarry(newChoice: string) {
  if (props.item?.type === 'backpack') return null
  return carryChoices.value.find((choice) => choice.id === newChoice)?.toggleTrigger()
}

defineExpose({ activeRoll })
</script>

<template>
  <div data-component="EquipmentDetails">
    <div class="my-2">
      <Transition
        enter-active-class="transform transition-all duration-100 overflow-hidden"
        enter-from-class="opacity-0 max-h-0"
        enter-to-class="opacity-100 max-h-24"
        leave-active-class="transform transition-all duration-100 ease-in overflow-hidden"
        leave-from-class="opacity-100 max-h-24"
        leave-to-class="opacity-0 max-h-0"
      >
        <div v-if="item?.type !== 'backpack' && backpacks.length > 0" class="mb-2">
          <span data-part="container-label" class="mb-1 block">{{
            $t('equipment.containerLabel')
          }}</span>
          <div class="flex items-center gap-2">
            <DropdownWidget
              class="flex-1"
              :list="containerList"
              :selectedId="item?.system?.containerId ?? ''"
              :changed="changeContainer"
              growContainer
            />
            <button
              v-if="inventoryMode !== undefined"
              type="button"
              data-part="inventory-mode-toggle"
              @click="
                emit('moveToInventory', inventoryMode === 'individual' ? 'party' : 'individual')
              "
            >
              <template v-if="inventoryMode === 'individual'">
                <img :src="meepleGroupIcon" class="h-6.25" alt="" />
                <span>›</span>
              </template>
              <template v-else>
                <span>‹</span>
                <img :src="meepleIcon" class="h-6.25" alt="" />
              </template>
            </button>
          </div>
        </div>
      </Transition>
      <ChoiceWidget
        v-if="item?.type !== 'backpack' && !hideCarryType"
        class="w-full"
        :selected="carryChoices.find((choice) => choice.toggleIsActive())?.id"
        :choiceSet="carryChoices.map((choice) => choice.id)"
        :labelSet="carryLabels"
        :clicked="selectCarry"
      />
      <Transition
        enter-active-class="transform transition-all duration-100 overflow-hidden"
        enter-from-class="opacity-0 max-h-0"
        enter-to-class="opacity-100 max-h-6"
        leave-active-class="transform transition-all duration-100 ease-in overflow-hidden"
        leave-from-class="opacity-100 max-h-6"
        leave-to-class="opacity-0 max-h-0"
      >
        <div v-if="item?.system.equipped.carryType === 'worn' && itemWornType" class="flex h-6">
          <ToggleWidget
            :active="item?.system?.equipped?.inSlot"
            :clicked="
              () =>
                item?.changeCarry?.(
                  item?.system?.equipped?.carryType,
                  item?.system?.equipped?.handsHeld,
                  item?.system?.containerId,
                  !item?.system?.equipped?.inSlot
                )
            "
          />
          <span
            class="text-md ml-2 align-middle"
            :class="{ 'text-gray-400': !item?.system?.equipped?.inSlot }"
          >
            {{
              item?.system?.equipped?.inSlot
                ? `Item equipped (${capitalize(itemWornType)})`
                : 'Item not equipped'
            }}
          </span>
        </div>
      </Transition>
      <div
        class="flex py-1"
        v-if="
          item?.system?.equipped?.carryType === 'worn' &&
          (item?.system?.equipped?.invested === true || item?.system?.equipped?.invested === false)
        "
      >
        <ToggleWidget
          :active="item?.system.equipped.invested"
          :clicked="() => item?.toggleInvested?.(!item.system.equipped.invested)"
        />
        <span
          class="text-md ml-2 align-middle"
          :class="{ 'text-gray-400': !item?.system.equipped.invested }"
        >
          {{ item?.system.equipped.invested ? `Item invested` : 'Item not invested' }}
        </span>
      </div>
    </div>
    <ParsedDescription
      ref="description"
      :text="item?.system?.description.value"
      :labels="labels"
      :itemId="item?._id ?? undefined"
    />
    <div class="flex">
      <div class="flex-1 text-xl">Qty: {{ item?.system?.quantity }}</div>
      <div class="ml-auto flex justify-end gap-1" v-if="item?.system?.uses?.value !== undefined">
        <div class="text-xl">{{ $t('equipment.usesLabel') }}</div>
        <CounterWidget
          :title="item?.name + ' (uses)'"
          class="-mt-1 h-6"
          :value="item?.system?.uses?.value"
          :max="item?.system?.uses?.max"
          @changeCount="(newValue: number) => item?.changeUses?.(newValue)"
          editable
        />
      </div>
    </div>
  </div>
</template>
