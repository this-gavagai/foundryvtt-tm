import { computed, ref, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  ringLayers,
  settledRingLayers,
  type RingLayers,
  type RingLayerRequest
} from '@/api/tokenRingAssets'
import { useTokenRingStore } from '@/stores/tokenRing'
import type { PortraitRing } from '@/utils/tokenPortrait'

// Raster sizes the ring layers are built at. Quantizing means every avatar of a
// similar size shares one cached pair of images instead of compositing its own,
// which matters most in chat, where dozens of rows ask at once.
const SIZE_BUCKETS = [64, 128, 256, 512]

export function ringRasterSize(cssPx: number): number {
  const wanted = cssPx * (globalThis.devicePixelRatio || 1)
  return SIZE_BUCKETS.find((bucket) => bucket >= wanted) ?? SIZE_BUCKETS[SIZE_BUCKETS.length - 1]
}

// Resolve the tinted ring/background images for a token's ring, or undefined
// while they load — and permanently if the world's ring can't be fetched, in
// which case the caller just shows the art on its own.
export function useTokenRingLayers(
  ring: Ref<PortraitRing | undefined>,
  cssPx: Ref<number>
): Ref<RingLayers | undefined> {
  const { spritesheet } = storeToRefs(useTokenRingStore())
  const layers = ref<RingLayers | undefined>(undefined)

  // Watch the request itself rather than the ring object: callers rebuild that
  // object freely (chat reassembles its message views on any world change), so
  // its identity churns while the ring it describes stays put.
  const request = computed<RingLayerRequest | undefined>(() =>
    ring.value && spritesheet.value
      ? {
          spritesheet: spritesheet.value,
          gridSize: ring.value.gridSize,
          ringColor: ring.value.ringColor,
          backgroundColor: ring.value.backgroundColor,
          px: ringRasterSize(cssPx.value)
        }
      : undefined
  )

  // Serializes resolution instead of comparing identities: only the newest
  // request may write, so a slow earlier one can't land on top of it.
  let latest = 0

  watch(
    () => (request.value ? JSON.stringify(request.value) : ''),
    () => {
      const current = request.value
      const ticket = ++latest
      if (!current) {
        layers.value = undefined
        return
      }
      // Already built for this ring? Adopt it in the same tick, so a remount
      // re-renders with the ring rather than without it.
      const alreadyBuilt = settledRingLayers(current)
      if (alreadyBuilt) {
        layers.value = alreadyBuilt
        return
      }
      ringLayers(current)
        .then((resolved) => {
          if (ticket === latest) layers.value = resolved
        })
        .catch(() => {
          if (ticket === latest) layers.value = undefined
        })
    },
    { immediate: true }
  )

  return layers
}
