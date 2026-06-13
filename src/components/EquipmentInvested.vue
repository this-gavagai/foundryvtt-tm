<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { Equipment } from '@/composables/character'

import { useInjectedCharacter } from '@/composables/injectKeys'
import Spinner from '@/components/widgets/SpinnerWidget.vue'

const character = useInjectedCharacter()
const { inventory } = character

const pendingItemIds = reactive(new Set<string>())
const investedItems = computed(() =>
  inventory.value?.filter(
    (i: Equipment) =>
      i.system?.equipped?.invested === true || i.system?.equipped?.invested === false
  )
)

function isPending(item: Equipment) {
  return !!item._id && pendingItemIds.has(item._id)
}

async function toggleInvested(item: Equipment) {
  if (!item._id || !item.toggleInvested || pendingItemIds.has(item._id)) return

  pendingItemIds.add(item._id)
  try {
    await item.toggleInvested(!item.system?.equipped?.invested)
  } finally {
    pendingItemIds.delete(item._id)
  }
}
</script>
<template>
  <ul data-component="EquipmentInvested">
    <li
      v-for="i in investedItems"
      :data-invested="i.system?.equipped?.invested ? 'true' : 'false'"
      :key="i._id"
    >
      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 text-left active:text-gray-500 disabled:cursor-wait disabled:opacity-50"
        :disabled="isPending(i)"
        @click="toggleInvested(i)"
      >
        <span class="inline-flex w-4 justify-center">
          <Spinner v-if="isPending(i)" class="h-4 w-4" />
          <span v-else>{{ i.system?.equipped?.invested ? '✓' : 'ｘ' }}</span>
        </span>
        <span>{{ i.name }}</span>
      </button>
    </li>
  </ul>
</template>
