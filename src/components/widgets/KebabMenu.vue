<script lang="ts">
// Module-scoped (not inside `<script setup>`, which re-runs per instance) so
// each mounted KebabMenu gets a distinct panel id.
let kebabInstanceCount = 0
</script>

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
// coordinates. The panel prefers to right-align to the button, but is clamped
// within the viewport (and flips above the button) so it never lands off-screen
// — e.g. when the trigger sits far from the right edge on a wide chat bubble.
const props = defineProps<{
  items: { id: string; label: string; danger?: boolean }[]
  label: string
  // Optional row of single-tap choices rendered above the item list — short
  // glyph-sized options (the chat reaction palette) where a stacked text list
  // would be six rows of the same word. `active` marks an already-chosen pick,
  // whose tap deselects. Each is a real MenuItem, so keyboard navigation and
  // close-on-select come for free.
  quickPicks?: { value: string; label: string; active?: boolean }[]
}>()

const emit = defineEmits<{ select: [id: string]; quickPick: [value: string] }>()

// The panel is a plain menu when there are no quick picks; with both, the row
// needs a rule between it and the items below.
const hasQuickPicks = () => !!props.quickPicks?.length

const buttonWrapper = ref<HTMLElement | null>(null)
const itemsStyle = ref<Record<string, string>>({})

// Unique id per instance so measure() can find THIS menu's teleported panel to
// read its size (several kebab menus coexist in the DOM via `static`).
const menuId = `tm-kebab-menu-${(kebabInstanceCount += 1)}`

// Render above the modal that contains us (overlays start at z-index 60). When
// no overlay is open we're a page-level menu, so fall back to 50.
const topOverlayZIndex = useTopOverlayZIndex()

const VIEWPORT_MARGIN = 8

function measure() {
  const el = buttonWrapper.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  // Measure the (rendered) panel so we can keep it fully on-screen; fall back to
  // a sensible width before it's first laid out.
  const panel = document.getElementById(menuId)
  const pw = panel?.offsetWidth || 224
  const ph = panel?.offsetHeight || 0

  // Prefer right edge aligned to the button, then clamp horizontally.
  let left = rect.right - pw
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - pw - VIEWPORT_MARGIN))

  // Below the button, flipping above it when there's no room below.
  let top = rect.bottom + 4
  if (ph && top + ph > vh - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, rect.top - ph - 4)

  itemsStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
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

// Open the menu programmatically (e.g. from a long-press elsewhere). Clicking
// the trigger toggles the Headless menu open and runs onButtonClick → measure.
function openMenu() {
  buttonWrapper.value?.querySelector<HTMLButtonElement>('button')?.click()
}
defineExpose({ openMenu })
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
        <EllipsisVerticalIcon class="h-6 w-6" aria-hidden="true" />
      </MenuButton>
    </div>
    <!-- `static` keeps MenuItems in the DOM whether the menu is open or not,
         which gives Teleport stable children to render; `v-show` drives
         visibility (mirrors DropdownWidget).

         select-none on the whole panel, unconditionally: a menu is actions, not
         content, so there is never anything here worth selecting. It also closes
         a specific touch bug — the menu can open UNDER a finger that is still
         held down (a long-press on a chat bubble opens it at 450ms, while iOS's
         own press-and-hold selection fires at ~500ms), so without this the
         gesture that opened the menu goes on to select the label it landed on.
         The callout suppression stops the same press raising iOS's copy/share
         bubble over the menu. -->
    <Teleport to="body">
      <MenuItems
        :id="menuId"
        static
        v-show="open"
        :style="itemsStyle"
        data-part="kebab-menu-items"
        class="max-h-60 w-max max-w-64 min-w-36 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 select-none [-webkit-touch-callout:none] focus:outline-hidden"
      >
        <div
          v-if="hasQuickPicks()"
          data-part="kebab-menu-quick-picks"
          class="flex items-center gap-0.5 px-1.5 py-1"
          :class="items.length ? 'mb-1 border-b border-gray-200 pb-2' : ''"
        >
          <MenuItem v-for="pick in quickPicks" :key="pick.value" v-slot="{ active }">
            <button
              type="button"
              data-part="kebab-menu-quick-pick"
              class="cursor-pointer rounded-full px-1.5 py-1 text-xl leading-none"
              :aria-label="pick.label"
              :title="pick.label"
              :data-active="active ? true : undefined"
              :data-selected="pick.active ? true : undefined"
              :class="[pick.active ? 'bg-blue-100' : '', active ? 'bg-gray-100' : '']"
              @pointerdown="triggerLightHapticFeedback()"
              @click="emit('quickPick', pick.value)"
            >
              {{ pick.value }}
            </button>
          </MenuItem>
        </div>
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
