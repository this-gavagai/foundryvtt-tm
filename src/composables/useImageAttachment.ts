import { computed, onBeforeUnmount, readonly, ref } from 'vue'
import { logger } from '@/utils/utilities'
import {
  ImagePrepareError,
  imageUploadSupported,
  prepareImageForUpload,
  type ImagePrepareErrorKind,
  type PreparedImage
} from '@/utils/imageUpload'

// Composer-side state for a single picked image awaiting send. The mirror of
// useAudioRecorder for the image button: it holds the prepared bytes, a preview
// object URL, and an error kind — but the "capture" is just picking a file, so
// there's no recording lifecycle, only pick / reset.
export function useImageAttachment() {
  const prepared = ref<PreparedImage | null>(null)
  const previewUrl = ref<string | null>(null)
  const errorKind = ref<ImagePrepareErrorKind | null>(null)
  const isPreparing = ref(false)

  const hasImage = computed(() => !!prepared.value)

  function revokePreview() {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }

  // Validate + downscale the picked file, then build a preview. A failure sets
  // errorKind and leaves any prior selection cleared.
  async function pick(file: File | null | undefined) {
    if (!file) return
    errorKind.value = null
    if (!imageUploadSupported()) {
      errorKind.value = 'failed'
      return
    }
    isPreparing.value = true
    try {
      const result = await prepareImageForUpload(file)
      prepared.value = result
      revokePreview()
      previewUrl.value = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }))
    } catch (error) {
      logger.warn('image upload: failed to prepare picked image', error)
      prepared.value = null
      revokePreview()
      errorKind.value = error instanceof ImagePrepareError ? error.kind : 'failed'
    } finally {
      isPreparing.value = false
    }
  }

  function reset() {
    prepared.value = null
    revokePreview()
    errorKind.value = null
    isPreparing.value = false
  }

  onBeforeUnmount(reset)

  return {
    // Not readonly-wrapped: it carries a Uint8Array handed straight to the
    // chunked upload, and a deep-readonly proxy would fight that call's types.
    prepared,
    previewUrl: readonly(previewUrl),
    errorKind: readonly(errorKind),
    isPreparing: readonly(isPreparing),
    hasImage,
    pick,
    reset
  }
}
