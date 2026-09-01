<script setup lang="ts">
import { computed } from 'vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'

const { item } = defineProps(['item'])
const emits = defineEmits(['itemClicked'])

// Coin stacks used to need their own Bulk rule here (PF2e accrues 1 Bulk per
// 1000 coins, so their per-unit bulk.value says nothing useful). They no longer
// reach this component — the purse panel owns them, and EquipmentList filters
// them out of every list — so the rule went with them.
const totalWeight = computed(() => {
  if (item?.system?.bulk?.value === 0) return '-'
  else if (item?.system?.bulk?.value < 1)
    return (
      Math.floor(
        ((item?.system?.bulk?.value * item?.system?.quantity) / (item?.system?.price?.per ?? 1)) *
          10
      ) + 'L'
    )
  else return Math.floor(item?.system?.bulk?.value * item?.system?.quantity)
})
</script>
<template>
  <div>
    <!-- Dropping an item fades what it is, never what it weighs: PF2e's
         computeTotalBulk pays no attention to carryType, so a dropped item is
         still pulling on the Bulk meter and its number has to stay readable.
         The fade lives on the cells it applies to rather than on the row —
         inherited, it reached the weight too, and only the *numeric* weight,
         since the "L"/"—" case sets a colour of its own. -->
    <ViewableItem
      class="grid grid-cols-[auto_30px_20px] items-end gap-x-1"
      :class="{ 'ml-3': item?.system?.containerId }"
      :data-dropped="item.system?.equipped?.carryType === 'dropped' ? 'true' : undefined"
      @click="() => emits('itemClicked', item)"
    >
      <div
        class="truncate"
        :class="{
          italic: item.type === 'backpack',
          'text-gray-300': item.system?.equipped?.carryType === 'dropped'
        }"
      >
        {{ item.label ?? item.name }}
      </div>
      <div
        class="text-right text-xs font-normal"
        :class="{ 'text-gray-300': item.system?.equipped?.carryType === 'dropped' }"
      >
        (x{{ item?.system?.quantity }})
      </div>
      <div
        data-part="item-weight"
        class="text-right text-xs"
        :class="[
          typeof totalWeight === 'number' ? 'font-semibold' : 'font-normal text-gray-600'
        ]"
        :data-numeric="typeof totalWeight === 'number'"
      >
        {{ totalWeight }}
      </div>
    </ViewableItem>
    <ViewableItem
      v-for="subitem in item?.system?.subitems"
      :key="subitem._id"
      class="block truncate pl-4 text-sm"
      @click="() => emits('itemClicked', subitem)"
    >
      {{ subitem.label ?? subitem.name }}
    </ViewableItem>
  </div>
</template>
