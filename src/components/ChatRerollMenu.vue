<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { EllipsisVerticalIcon } from '@heroicons/vue/24/outline'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'
import type { ChatRollRerollMode } from '@/types/api-types'

defineProps<{
  canTrigger: (mode: ChatRollRerollMode) => boolean
  pending: boolean
}>()

const emit = defineEmits<{
  select: [mode: ChatRollRerollMode]
}>()

// One entry per reroll mode; hero-point is highlighted as the resource-spending
// option. `action` keys match the pre-refactor data-action attributes.
const rerollModes: {
  mode: ChatRollRerollMode
  action: string
  labelKey: string
  itemClass: string
  activeClass: string
}[] = [
  {
    mode: 'hero-point',
    action: 'hero-point-reroll',
    labelKey: 'chat.heroPointReroll',
    itemClass: 'text-amber-800',
    activeClass: 'bg-amber-50'
  },
  {
    mode: 'reroll',
    action: 'reroll',
    labelKey: 'chat.reroll',
    itemClass: '',
    activeClass: 'bg-gray-100 text-gray-900'
  },
  {
    mode: 'keep-highest',
    action: 'reroll-keep-highest',
    labelKey: 'chat.rerollKeepHighest',
    itemClass: '',
    activeClass: 'bg-gray-100 text-gray-900'
  },
  {
    mode: 'keep-lowest',
    action: 'reroll-keep-lowest',
    labelKey: 'chat.rerollKeepLowest',
    itemClass: '',
    activeClass: 'bg-gray-100 text-gray-900'
  }
]
</script>

<template>
  <Menu as="div" data-part="chat-roll-menu" class="absolute top-1.5 right-1.5">
    <MenuButton
      type="button"
      data-part="chat-roll-menu-button"
      class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="$t('chat.rollActions')"
      :aria-busy="pending"
      @pointerdown="triggerLightHapticFeedback()"
    >
      <EllipsisVerticalIcon class="h-5 w-5" aria-hidden="true" />
    </MenuButton>
    <MenuItems
      data-part="chat-roll-menu-items"
      class="absolute right-0 z-20 mt-1 w-48 rounded-md border border-gray-200 bg-white py-1 text-xs font-semibold text-gray-700 shadow-lg ring-1 ring-black/5 focus:outline-hidden"
    >
      <MenuItem v-for="entry in rerollModes" :key="entry.mode" v-slot="{ active }">
        <button
          type="button"
          :data-action="entry.action"
          data-part="chat-roll-menu-item"
          class="block w-full px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          :class="[entry.itemClass, active ? entry.activeClass : '']"
          :data-active="active ? true : undefined"
          :disabled="!canTrigger(entry.mode)"
          :aria-busy="pending"
          @pointerdown="triggerLightHapticFeedback()"
          @click="emit('select', entry.mode)"
        >
          {{ $t(entry.labelKey) }}
        </button>
      </MenuItem>
    </MenuItems>
  </Menu>
</template>
