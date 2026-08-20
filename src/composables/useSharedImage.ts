import { readonly, ref } from 'vue'
import type { ShareImagePayload } from '@/api/socketSetup'

// The image a GM most recently shared, or null when nothing is showing.
// Module-level (like useOverlayStack) rather than a Pinia store: it is ephemeral
// view state with a single writer — the socket wiring — and a single reader, the
// SharedImageModal mounted once at the app root.
const current = ref<ShareImagePayload | null>(null)

export function useSharedImage() {
  // A second share while one is open replaces it: the GM moved on, and the
  // player should be looking at whatever was shared last.
  function showSharedImage(payload: ShareImagePayload) {
    current.value = payload
  }

  function dismissSharedImage() {
    current.value = null
  }

  return { sharedImage: readonly(current), showSharedImage, dismissSharedImage }
}
