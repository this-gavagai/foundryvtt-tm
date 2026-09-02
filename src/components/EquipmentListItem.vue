<script setup lang="ts">
import { computed } from 'vue'
import ViewableItem from '@/components/widgets/ViewableItem.vue'
import UsesWidget from '@/components/widgets/UsesWidget.vue'

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

// Charges worth showing, following PF2e's own item-line rule: a pool of more
// than one, or a wand — a wand is 1/day, and "spent until tomorrow" is exactly
// what a row of one empty pip is there to say. Single-use consumables (potions,
// scrolls) are excluded: their quantity already answers "how many are left".
const uses = computed(() => {
  const max = item?.system?.uses?.max
  if (typeof max !== 'number' || max < 1) return undefined
  if (max === 1 && item?.system?.category !== 'wand') return undefined
  return item.system.uses
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
        class="flex min-w-0 items-baseline gap-1"
        :class="{
          italic: item.type === 'backpack',
          'text-gray-300': item.system?.equipped?.carryType === 'dropped'
        }"
      >
        <!-- The name truncates; the charges never do — a half-spent wand of
             fireball is the reason to look at the row at all. -->
        <span class="w-full truncate">{{ item.label ?? item.name }}</span>
        <UsesWidget
          v-if="uses"
          class="shrink-0 text-gray-600"
          :value="uses.value"
          :max="uses.max"
        />
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
        :class="[typeof totalWeight === 'number' ? 'font-semibold' : 'font-normal text-gray-600']"
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
