<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { CheckIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import type { WhisperSelectionMode, WhisperTarget } from '@/composables/useWhisperTargets'

defineProps<{
  groupTargets: WhisperTarget[]
  userTargets: WhisperTarget[]
  selectedMode: WhisperSelectionMode
  selectedLabel: string
  // Whether the current selection whispers (drives the private accent color).
  isPrivate: boolean
  isUserSelected: (key: string) => boolean
}>()

const emit = defineEmits<{
  selectGroup: [key: string]
  toggleUser: [key: string]
}>()
</script>

<template>
  <div data-part="chat-recipient" class="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
    <span>{{ $t('chat.to') }}</span>
    <Menu as="div" class="relative min-w-0">
      <MenuButton
        type="button"
        data-part="chat-recipient-button"
        class="inline-flex max-w-56 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
        :class="
          isPrivate
            ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
            : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
        "
        :aria-label="$t('chat.recipient')"
      >
        <span class="truncate">{{ selectedLabel }}</span>
        <ChevronDownIcon class="h-3.5 w-3.5 flex-none" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        data-part="chat-recipient-menu"
        class="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-black/5 focus:outline-hidden"
      >
        <MenuItem v-for="target in groupTargets" :key="target.key" v-slot="{ active }">
          <button
            type="button"
            data-part="chat-recipient-menu-item"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
            :class="active ? 'bg-gray-100 text-gray-900' : ''"
            @click="emit('selectGroup', target.key)"
          >
            <span class="min-w-0 flex-1 truncate">{{ target.label }}</span>
            <CheckIcon
              v-if="selectedMode === target.key"
              class="h-4 w-4 flex-none text-blue-600"
              aria-hidden="true"
            />
          </button>
        </MenuItem>
        <div v-if="userTargets.length" class="my-1 border-t border-gray-200" aria-hidden="true" />
        <MenuItem v-for="target in userTargets" :key="target.key" as="div" v-slot="{ active }">
          <button
            type="button"
            data-part="chat-recipient-menu-item"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
            :class="active ? 'bg-gray-100 text-gray-900' : ''"
            :aria-pressed="isUserSelected(target.key)"
            @click.prevent.stop="emit('toggleUser', target.key)"
          >
            <span class="min-w-0 flex-1 truncate">{{ target.label }}</span>
            <CheckIcon
              v-if="isUserSelected(target.key)"
              class="h-4 w-4 flex-none text-blue-600"
              aria-hidden="true"
            />
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  </div>
</template>
