<script setup lang="ts">
import { ref } from 'vue'

// Warns that the browser engine is too old to apply the stylesheet. Mounted by
// main.ts only when utils/cssSupport says so, on its own host element outside
// #app — the template root there is a v-if/v-else pair, and #modals belongs to
// the Teleport overlays. Advisory only: the app still works, it just renders
// unstyled, so the notice can be dismissed for the session.
//
// Everything here is styled with inline attributes rather than utility classes,
// deliberately. The stylesheet this warns about is the one that failed to
// apply, so a class-driven banner would render as unstyled text inside an
// unstyled page — indistinguishable from the problem it is reporting.
const dismissed = ref(false)
</script>

<template>
  <div
    v-if="!dismissed"
    data-component="UnsupportedBrowserNotice"
    role="alert"
    style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      box-sizing: border-box;
      padding: 12px 16px;
      background: #7f1d1d;
      color: #ffffff;
      font-family:
        system-ui,
        -apple-system,
        Segoe UI,
        Roboto,
        sans-serif;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    "
  >
    <strong style="display: block; font-size: 15px; margin-bottom: 4px">
      {{ $t('unsupportedBrowser.title') }}
    </strong>
    <span>{{ $t('unsupportedBrowser.message') }}</span>
    <button
      type="button"
      style="
        display: block;
        margin-top: 10px;
        padding: 6px 12px;
        border: 0;
        border-radius: 4px;
        background: #ffffff;
        color: #7f1d1d;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      "
      @click="dismissed = true"
    >
      {{ $t('unsupportedBrowser.dismiss') }}
    </button>
  </div>
</template>
