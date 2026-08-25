<script setup lang="ts">
import { computed, toRef } from 'vue'
import { getPath } from '@/utils/utilities'
import { useTokenRingLayers } from '@/composables/useTokenRingLayers'
import type { PortraitRing } from '@/utils/tokenPortrait'

// A token's art as Foundry draws it: for a dynamic-ring token the ring's
// background, then the ring, then the subject art on top at its subject scale
// (the canvas shader blends in exactly that order — the art is not masked by
// the ring, it simply carries transparent padding). Without a ring it is the
// plain scaled art this app has always shown.
//
// Fills its parent, so callers keep owning the size and — when there's no ring
// — the shape. A drawn ring is circular, so it brings its own round clip: the
// art at a subject scale above 1 has to be contained somewhere, and the ring's
// own outline is the honest boundary.
const props = withDefaults(
  defineProps<{
    url?: string
    scaleX?: number
    scaleY?: number
    ring?: PortraitRing
    alt?: string
    // Rendered edge length in CSS pixels; sets the ring raster resolution only.
    px?: number
    objectFit?: 'contain' | 'cover'
    lazy?: boolean
  }>(),
  { scaleX: 1, scaleY: 1, alt: '', px: 96, objectFit: 'contain', lazy: false }
)

const layers = useTokenRingLayers(
  toRef(props, 'ring'),
  computed(() => props.px)
)
const src = computed(() => (props.url ? getPath(props.url) : undefined))
</script>

<template>
  <div class="relative h-full w-full" :class="layers ? 'overflow-hidden rounded-full' : ''">
    <img
      v-if="layers?.background"
      :src="layers.background"
      class="pointer-events-none absolute inset-0 h-full w-full"
      alt=""
      aria-hidden="true"
    />
    <img
      v-if="layers"
      :src="layers.ring"
      class="pointer-events-none absolute inset-0 h-full w-full"
      alt=""
      aria-hidden="true"
    />
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      :style="{ '--sx': scaleX, '--sy': scaleY }"
      class="pointer-events-none h-full w-full scale-x-(--sx) scale-y-(--sy)"
      :class="[
        objectFit === 'cover' ? 'object-cover' : 'object-contain',
        layers ? 'absolute inset-0' : ''
      ]"
      :loading="lazy ? 'lazy' : undefined"
      :decoding="lazy ? 'async' : undefined"
    />
  </div>
</template>
