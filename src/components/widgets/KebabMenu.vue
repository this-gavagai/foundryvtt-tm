<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue'
import { EllipsisVerticalIcon } from '@heroicons/vue/24/outline'
import { useTopOverlayZIndex } from '@/composables/useOverlayStack'
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

// Small ⋮ dropdown of one-shot actions. The items panel is teleported to
// <body> so ancestor `overflow: hidden` (e.g. the themes' glass section
// cards) and transformed containing blocks can't clip it — same pattern as
// DropdownWidget: measure the button and position the panel with fixed
// coordinates, right edge aligned to the button.
withDefaults(
  defineProps<{
    items: { id: string; label: string; danger?: boolean }[]
    label: string
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' }
)

const emit = defineEmits<{ select: [id: string] }>()

const buttonWrapper = ref<HTMLElement | null>(null)
const itemsStyle = ref<Record<string, string>>({})

// Render above the modal that contains us (overlays start at z-index 60). When
// no overlay is open we're a page-level menu, so fall back to 50.
const topOverlayZIndex = useTopOverlayZIndex()

function measure() {
  const el = buttonWrapper.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  itemsStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    right: `${document.documentElement.clientWidth - rect.right}px`,
    zIndex: `${topOverlayZIndex.value > 0 ? topOverlayZIndex.value + 1 : 50}`
  }
}

// Capture-mode so scrolls in ancestor containers trigger repositioning —
// bubble doesn't reach a teleported child.
onMounted(() => {
  window.addEventListener('scroll', measure, true)
  window.addEventListener('resize', measure)
})
onUnmounted(() => {
  window.removeEventListener('scroll', measure, true)
  window.removeEventListener('resize', measure)
})

// Measure on button click so the panel starts at the right place even before
// any scroll happens.
function onButtonClick() {
  void nextTick(measure)
}
</script>

<template>
  <Menu as="div" v-slot="{ open }" data-part="kebab-menu" class="flex">
    <div ref="buttonWrapper" class="flex" @click="onButtonClick">
      <MenuButton
        type="button"
        data-part="kebab-menu-button"
        class="cursor-pointer rounded-md text-gray-400 transition duration-180 ease-out focus:outline-hidden active:scale-[0.90] active:opacity-50 active:duration-60"
        :aria-label="label"
        @pointerdown="triggerLightHapticFeedback()"
      >
        <EllipsisVerticalIcon :class="size === 'sm' ? 'h-5 w-5' : 'h-6 w-6'" aria-hidden="true" />
      </MenuButton>
    </div>
    <!-- `static` keeps MenuItems in the DOM whether the menu is open or not,
         which gives Teleport stable children to render; `v-show` drives
         visibility (mirrors DropdownWidget). -->
    <Teleport to="body">
      <MenuItems
        static
        v-show="open"
        :style="itemsStyle"
        data-part="kebab-menu-items"
        class="max-h-60 w-max min-w-36 max-w-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-hidden"
      >
        <MenuItem v-for="item in items" :key="item.id" v-slot="{ active }">
          <button
            type="button"
            data-part="kebab-menu-item"
            class="block w-full truncate px-3 py-2 text-left"
            :data-active="active ? true : undefined"
            :data-danger="item.danger ? true : undefined"
            :class="[
              item.danger ? 'text-red-600' : '',
              active ? (item.danger ? 'bg-red-50' : 'bg-gray-100') : ''
            ]"
            @pointerdown="triggerLightHapticFeedback()"
            @click="emit('select', item.id)"
          >
            {{ item.label }}
          </button>
        </MenuItem>
      </MenuItems>
    </Teleport>
  </Menu>
</template>
