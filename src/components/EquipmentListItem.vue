<script setup lang="ts">
// TODO (bug): items in deleted containers disappear from list
import { computed } from 'vue'
const { item } = defineProps(['item'])
const emits = defineEmits(['itemClicked'])

const totalWeight = computed(() => {
  if (item?.system?.bulk?.value === 0 || item?.system?.stackGroup === 'coins') return '-'
  else if (item?.system?.bulk?.value < 1)
    return Math.floor(item?.system?.bulk?.value * item?.system?.quantity * 10) + 'L'
  else return Math.floor(item?.system?.bulk?.value * item?.system?.quantity)
})
</script>
<template>
  <a
    class="grid cursor-pointer grid-cols-[auto_30px_20px] items-end gap-1"
    :class="{
      'text-gray-300': item.system?.equipped?.carryType === 'dropped',
      'ml-3': item?.system?.containerId
    }"
    @click="() => emits('itemClicked', item)"
  >
    <div class="truncate" :class="{ italic: item.type === 'backpack' }">{{ item.name }}</div>
    <!-- <div class="flex gap-1"> -->
    <div class="text-right text-xs font-light">(x{{ item?.system?.quantity }})</div>
    <div
      class="text-right text-xs"
      :class="[
        item?.system?.bulk?.value < 1 || item?.system?.stackGroup === 'coins'
          ? 'font-light text-gray-600'
          : 'font-semibold'
      ]"
    >
      {{ totalWeight }}
    </div>
    <!-- </div> -->
  </a>
</template>
