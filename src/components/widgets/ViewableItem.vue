<script setup lang="ts">
import { triggerLightHapticFeedback } from '@/composables/useHapticFeedback'

// A tappable text link that "views" an item (feat, spell, equipment, identity,
// …) — typically opening it in a modal. Renders an <a> on purpose: native
// <button> elements suppress the press transform in iOS WebKit, so the zoom
// would silently not animate. The tactile press feedback (scale + dim) is baked
// in; `scale` picks how far it travels.
//
// The consumer attaches the tap behaviour via @click (falls through to the <a>
// root). role="button" + tabindex make it a real, focusable control despite
// the <a>-with-no-href, and keyboard activation re-dispatches a click so that
// same @click fires — so every feat/spell/action/inventory row is reachable
// and operable by keyboard, not just touch.
//
// This sets no `display` — pass one (`inline-block`, `flex`, `grid`, …) at the
// call site. CSS transforms don't apply to inline boxes, so inline text links
// need `inline-block` for the press effect to show.
withDefaults(defineProps<{ scale?: 'gentle' | 'firm' }>(), { scale: 'gentle' })

// Enter (on keydown) and Space (on keyup, with scroll suppressed on keydown)
// activate the control by firing a real click on it — matching native button
// semantics, so the consumer's @click handler runs unchanged.
function activate(e: KeyboardEvent) {
  ;(e.currentTarget as HTMLElement).click()
}
</script>
<template>
  <a
    role="button"
    tabindex="0"
    class="cursor-pointer rounded-xs transition duration-180 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:opacity-50 active:duration-60"
    :class="scale === 'firm' ? 'active:scale-[0.90]' : 'active:scale-[0.97]'"
    @pointerdown="triggerLightHapticFeedback"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent
    @keyup.space.prevent="activate"
  >
    <slot />
  </a>
</template>
