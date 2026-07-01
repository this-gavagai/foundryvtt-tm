<script setup lang="ts">
import { computed } from 'vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'

const { item } = defineProps(['item'])
const emits = defineEmits(['itemClicked'])

// Coins are negligible individually but accrue 1 Bulk per 1000 (PF2e RAW): 999
// coins are 0 Bulk, 1000 are 1, 2000 are 2. Their per-unit source bulk.value is
// meaningless for this, so compute the stack Bulk directly from quantity.
const COINS_PER_BULK = 1000

const totalWeight = computed(() => {
  if (item?.system?.stackGroup === 'coins') {
    const bulk = Math.floor((item?.system?.quantity ?? 0) / COINS_PER_BULK)
    return bulk === 0 ? '-' : bulk
  }
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
    <ViewableItem
      class="grid grid-cols-[auto_30px_20px] items-end gap-x-1"
      :class="{
        'text-gray-300': item.system?.equipped?.carryType === 'dropped',
        'ml-3': item?.system?.containerId
      }"
      @click="() => emits('itemClicked', item)"
    >
      <div class="truncate" :class="{ italic: item.type === 'backpack' }">
        {{ item.label ?? item.name }}
      </div>
      <div class="text-right text-xs font-light">(x{{ item?.system?.quantity }})</div>
      <div
        class="text-right text-xs"
        :class="[
          typeof totalWeight === 'number' ? 'font-semibold' : 'font-light text-gray-600'
        ]"
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
