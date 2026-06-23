<script setup lang="ts">
// A tappable text link that "views" an item (feat, spell, equipment, identity,
// …) — typically opening it in a modal. Renders an <a> on purpose: native
// <button> elements suppress the press transform in iOS WebKit, so the zoom
// would silently not animate. The tactile press feedback (scale + dim) is baked
// in; `scale` picks how far it travels.
//
// This sets no `display` — pass one (`inline-block`, `flex`, `grid`, …) at the
// call site. CSS transforms don't apply to inline boxes, so inline text links
// need `inline-block` for the press effect to show.
withDefaults(defineProps<{ scale?: 'gentle' | 'firm' }>(), { scale: 'gentle' })
</script>
<template>
  <a
    class="cursor-pointer transition duration-180 ease-out active:opacity-50 active:duration-60"
    :class="scale === 'firm' ? 'active:scale-[0.90]' : 'active:scale-[0.97]'"
  >
    <slot />
  </a>
</template>
