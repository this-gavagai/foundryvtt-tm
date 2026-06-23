<script setup lang="ts">
// Titled "card" section within a character-sheet tab (Feats, Actions, Skills,
// Equipment, Spells, …). Renders a <section data-section> with the shared
// heading treatment so the theme can target every section card uniformly via
// `section[data-section]` / its `h3`.
//
// Layout that varies by context — column-break behaviour, hide-when-empty,
// padding — is passed through as `class` on the call site (Vue merges it onto
// the root <section>). For headers that need more than a title (a DC, a
// counter, a clickable entry title) override the whole `#header` slot.
defineProps<{ section: string; title?: string }>()
</script>
<template>
  <section :data-section="section">
    <slot name="header">
      <h3 class="text-[1.1rem] font-normal tracking-[0.01em] underline">
        <slot name="title">{{ title }}</slot>
      </h3>
    </slot>
    <slot />
  </section>
</template>
