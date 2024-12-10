<script setup lang="ts">
import { computed } from 'vue'
const { item } = defineProps(['item'])
const emits = defineEmits(['itemClicked'])

const totalWeight = computed(() => {
  if (item?.system?.bulk?.value === 0 || item?.system?.stackGroup === 'coins') return '-'
  else if (item?.system?.bulk?.value < 1)
    return item?.system?.bulk?.value * item?.system?.quantity * 10 + 'L'
  else return (item?.system?.bulk?.value * item?.system?.quantity).toFixed(1)
})
</script>
<template>
  <a
    class="flex cursor-pointer items-center justify-between gap-1"
    :class="{
      'text-gray-300': item.system?.equipped?.carryType === 'dropped',
      'ml-3': item?.system?.containerId
    }"
    @click="() => emits('itemClicked', item)"
  >
    <div class="truncate" :class="{ italic: item.type === 'backpack' }">{{ item.name }}</div>
    <div class="flex justify-between gap-1">
      <div class="text-xs">(x{{ item?.system?.quantity }})</div>
      <div class="w-4 text-right text-xs">
        {{ totalWeight }}
      </div>
    </div>
  </a>
</template>
